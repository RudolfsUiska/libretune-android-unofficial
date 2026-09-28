import { ReactElement, useEffect, useRef, useState } from 'react';
import { SevenSegment } from './SevenSegment';
import {
  LIMITS,
  Led,
  afrLed,
  batteryLed,
  coolantLed,
  boostLed,
  rpmLed,
  useEngineReadings,
} from '../engineReadings';
import './MontegoDashboard.css';

/**
 * Engine dash after the 1984 MG Montego's LCD instrument panel, with a
 * curved bar tachometer in the manner of the C4 Corvette's: orange
 * seven-segment readouts, vertical bar gauges and coloured warning squares on
 * graph paper, unlit LCD segments faintly visible. Shows RPM, boost, coolant,
 * AFR and battery (../engineReadings.ts).
 *
 * Everything is one SVG laid out in grid units - the graph paper and every
 * element on it share coordinates, so the elements sit on the grid lines at
 * any screen size. The grid extends to fill the screen around the content.
 */

/** Readout text for the seven-segment digits (no '+': 7-seg has none). */
export const lcd = {
  rpm: (v: number | undefined) => (v === undefined ? '----' : String(Math.round(Math.max(0, v)))),
  boost: (v: number | undefined) => (v === undefined ? '-.--' : v.toFixed(2)),
  coolant: (v: number | undefined) => (v === undefined ? '---' : String(Math.round(v))),
  afr: (v: number | undefined) => (v === undefined ? '--.-' : v.toFixed(1)),
  battery: (v: number | undefined) => (v === undefined ? '--.-' : v.toFixed(1)),
};

// ---- Grid and layout, in grid units -----------------------------------------
/** Minor grid spacing; every element edge lands on a multiple of it. */
export const GRID = 2;
/** A major (brighter) line every this many units. */
const MAJOR = 10;
/** The laid-out content, and the smallest viewBox that holds it with a margin. */
export const CONTENT = { w: 98, h: 44 };
const MIN_VIEW = { w: CONTENT.w + 2 * GRID, h: CONTENT.h + 2 * GRID };

/**
 * ViewBox for a container of the given aspect (w/h): the content with a
 * margin, widened or deepened to the container's shape so the grid fills it,
 * and the content's origin offset by whole grid cells so it stays on the grid.
 */
export function viewFor(aspect: number) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : MIN_VIEW.w / MIN_VIEW.h;
  const w = Math.max(MIN_VIEW.w, MIN_VIEW.h * a);
  const h = w / a;
  const snap = (v: number) => Math.floor(v / GRID) * GRID;
  return { w, h, ox: snap((w - CONTENT.w) / 2), oy: snap((h - CONTENT.h) / 2) };
}

// ---- Curved tachometer (C4 Corvette style) ----------------------------------
/**
 * A quarter-ellipse sweep: rising from the lower left, curving over to run
 * across the top. Segments are laid perpendicular to the curve and lengthen
 * toward the redline.
 */
export const TACHO = {
  cx: 58,
  cy: 40,
  rx: 52,
  ry: 32,
  /** Sweep, in degrees on the ellipse: 180 = left end, 270 = top. */
  from: 180,
  to: 276,
  segments: 40,
  /** Segment length at the start and end of the sweep. */
  len0: 2,
  len1: 6,
};

/** Point on the tacho curve at fraction t, pushed outward by `off`. */
export function tachoPoint(t: number, off = 0) {
  const th = ((TACHO.from + (TACHO.to - TACHO.from) * t) * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  // Outward normal of the ellipse at this point
  const nx = c / TACHO.rx;
  const ny = s / TACHO.ry;
  const nl = Math.hypot(nx, ny);
  return {
    x: TACHO.cx + TACHO.rx * c + (off * nx) / nl,
    y: TACHO.cy + TACHO.ry * s + (off * ny) / nl,
  };
}

const segLen = (t: number) => TACHO.len0 + (TACHO.len1 - TACHO.len0) * t;

/** Segment colour: green, yellow in the last 1000 before the red. */
function tachoTone(rpmAtSegment: number): 'green' | 'yellow' | 'red' {
  if (rpmAtSegment >= LIMITS.rpm.red) return 'red';
  if (rpmAtSegment >= LIMITS.rpm.red - 1000) return 'yellow';
  return 'green';
}

function CurvedTacho({ rpm }: { rpm: number | undefined }) {
  const { max } = LIMITS.rpm;
  const n = TACHO.segments;
  const lit = rpm === undefined ? 0 : Math.round((Math.min(Math.max(rpm, 0), max) / max) * n);
  return (
    <g role="img" aria-label={`tachometer ${lcd.rpm(rpm)} rpm`}>
      {Array.from({ length: n }, (_, i) => {
        const t0 = i / n;
        const t1 = (i + 0.68) / n;
        const pts = [tachoPoint(t0), tachoPoint(t0, segLen(t0)), tachoPoint(t1, segLen(t1)), tachoPoint(t1)]
          .map((p) => `${p.x},${p.y}`)
          .join(' ');
        const tone = tachoTone(((i + 1) / n) * max);
        return <polygon key={i} points={pts} className={`mg-${tone} ${i < lit ? 'lit' : 'unlit'}`} />;
      })}
      {Array.from({ length: max / 1000 + 1 }, (_, k) => {
        const t = (k * 1000) / max;
        const p = tachoPoint(t, segLen(t) + 2.6);
        return (
          <text key={k} x={p.x} y={p.y} className="mg-scale" textAnchor="middle" dominantBaseline="central">
            {k}
          </text>
        );
      })}
      {/* Scale unit, in the free corner by the start of the sweep */}
      <text x={10} y={42} className="mg-caption" dominantBaseline="central">
        RPM x1000
      </text>
    </g>
  );
}

// ---- Bar gauges and warning squares ------------------------------------------
const BAR = { segments: 14, top: 6, pitch: 2 };

interface BarProps {
  x: number;
  title: string;
  top: string;
  bottom: string;
  value: number | undefined;
  min: number;
  max: number;
  tone: (valueAtSegment: number) => 'green' | 'yellow' | 'red';
  readout: string;
}

/** Vertical LCD bar, 4 units wide, one segment per grid row pair. */
function BarGauge({ x, title, top, bottom, value, min, max, tone, readout }: BarProps) {
  const n = BAR.segments;
  const bottomY = BAR.top + n * BAR.pitch;
  const lit = value === undefined ? 0 : Math.max(0, Math.min(n, Math.round(((value - min) / (max - min)) * n)));
  return (
    <g role="img" aria-label={`${title} ${readout}`}>
      <text x={x + 2} y={BAR.top - 2} className="mg-label" textAnchor="middle" dominantBaseline="central">
        {title}
      </text>
      {Array.from({ length: n }, (_, i) => {
        const v = min + ((i + 1) / n) * (max - min);
        return (
          <rect
            key={i}
            x={x}
            y={bottomY - (i + 1) * BAR.pitch + 0.25}
            width={4}
            height={BAR.pitch - 0.5}
            className={`mg-bar-seg mg-${tone(v)} ${i < lit ? 'lit' : 'unlit'}`}
          />
        );
      })}
      <text x={x + 5} y={BAR.top + 1} className="mg-mark" dominantBaseline="central">
        {top}
      </text>
      <text x={x + 5} y={bottomY - 1} className="mg-mark" dominantBaseline="central">
        {bottom}
      </text>
    </g>
  );
}

/** A 2x2-unit warning square with its label to the right. */
function Square({ x, y, state, label }: { x: number; y: number; state: Led; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={2} height={2} className={`mg-square mg-square-${state}`} />
      <text x={x + 2.6} y={y + 1} className="mg-tiny" dominantBaseline="central">
        {label}
      </text>
    </g>
  );
}

/** A small readout with its label beneath: 3 digits, 5 units high. */
function SmallReadout({ y, text, label, warn }: { y: number; text: string; label: string; warn: boolean }) {
  return (
    <g className={warn ? 'mg-warn' : undefined}>
      <SevenSegment text={text} digits={3} x={68} y={y} h={5} pitch={4} className="mg-digits" />
      <text x={68} y={y + 6.6} className="mg-label" dominantBaseline="central">
        {label}
      </text>
    </g>
  );
}

// ---- The dash ------------------------------------------------------------------
export default function MontegoDashboard({ isConnected }: { isConnected: boolean }) {
  const { rpm, boost, coolant, afr, battery } = useEngineReadings(isConnected);
  const { coolant: cl, boost: bo } = LIMITS;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(MIN_VIEW.w / MIN_VIEW.h);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setAspect(el.clientWidth / el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = viewFor(aspect);
  const lines: ReactElement[] = [];
  // Grid lines at multiples of GRID from the content origin, so they pass
  // through every element edge; majors every MAJOR units from that origin.
  for (let x = view.ox % GRID; x <= view.w; x += GRID) {
    const major = Math.round(x - view.ox) % MAJOR === 0;
    lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={view.h} className={major ? 'mg-grid-major' : 'mg-grid'} />);
  }
  for (let y = view.oy % GRID; y <= view.h; y += GRID) {
    const major = Math.round(y - view.oy) % MAJOR === 0;
    lines.push(<line key={`h${y}`} x1={0} y1={y} x2={view.w} y2={y} className={major ? 'mg-grid-major' : 'mg-grid'} />);
  }

  return (
    <div className="mg-dash" ref={wrapRef}>
      <svg className="mg-svg" viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet">
        <rect className="mg-glass" x={0} y={0} width={view.w} height={view.h} />
        <g>{lines}</g>
        <g transform={`translate(${view.ox} ${view.oy})`}>
          <CurvedTacho rpm={rpm} />

          {/* Big RPM readout, inside the sweep */}
          <g className={rpmLed(rpm) === 'warn' ? 'mg-warn' : undefined}>
            <SevenSegment text={lcd.rpm(rpm)} digits={4} x={24} y={18} h={15} pitch={11} className="mg-digits" />
            <text x={24} y={36} className="mg-label mg-label-lg" dominantBaseline="central">
              ENGINE RPM
            </text>
          </g>

          <SmallReadout y={2} text={lcd.battery(battery)} label="BATTERY V" warn={batteryLed(battery) === 'warn'} />
          <SmallReadout y={10} text={lcd.afr(afr)} label="AIR/FUEL" warn={false} />
          <SmallReadout y={18} text={lcd.coolant(coolant)} label="COOLANT °C" warn={coolantLed(coolant) === 'warn'} />
          <SmallReadout y={26} text={lcd.boost(boost)} label="BOOST BAR" warn={boostLed(boost) === 'warn'} />

          <Square x={68} y={36} state={isConnected ? 'ok' : 'warn'} label="ECU" />
          <Square x={74} y={36} state={coolantLed(coolant)} label="TMP" />
          <Square x={68} y={40} state={afrLed(afr)} label="AFR" />
          <Square x={74} y={40} state={batteryLed(battery)} label="CHG" />

          <BarGauge
            x={82}
            title="CLT"
            top="H"
            bottom="C"
            value={coolant}
            min={cl.min}
            max={cl.max}
            tone={(v) => (v >= cl.warn ? 'red' : v >= cl.caution ? 'yellow' : 'green')}
            readout={lcd.coolant(coolant)}
          />
          <BarGauge
            x={90}
            title="BOOST"
            top={`+${bo.max}`}
            bottom={String(bo.min)}
            value={boost}
            min={bo.min}
            max={bo.max}
            tone={(v) => (v >= bo.red ? 'red' : v >= bo.red - 0.5 ? 'yellow' : 'green')}
            readout={lcd.boost(boost)}
          />
        </g>
      </svg>
    </div>
  );
}
