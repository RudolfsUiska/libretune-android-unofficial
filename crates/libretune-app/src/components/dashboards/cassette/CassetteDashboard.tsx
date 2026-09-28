import '@fontsource/vt323/400.css';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/700.css';
import {
  LIMITS,
  Led,
  afrLed,
  batteryLed,
  boostLed,
  coolantLed,
  fmt,
  litSegments,
  redFromSegment,
  rpmLed,
  useEngineReadings,
} from '../engineReadings';
import './CassetteDashboard.css';

interface MeterProps {
  value: number | undefined;
  min: number;
  max: number;
  /** Segments at or above this value are red. */
  red?: number;
  segments: number;
  /** Rising bar heights, like the design system's power gauge. */
  stepped?: boolean;
}

/** Stepped bar meter: lit segments glow amber, the top range glows red. */
function Meter({ value, min, max, red, segments, stepped }: MeterProps) {
  const lit = value === undefined ? 0 : litSegments(value, min, max, segments);
  const redFrom = red === undefined ? segments : redFromSegment(red, min, max, segments);
  return (
    <div className={`cf-meter ${stepped ? 'cf-meter-stepped' : ''}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className={`cf-seg ${i < lit ? 'cf-seg-lit' : ''} ${i >= redFrom ? 'cf-seg-red' : ''}`}
          style={stepped ? { height: `${20 + (80 * (i + 1)) / segments}%` } : undefined}
        />
      ))}
    </div>
  );
}

function Light({ state, label }: { state: Led; label: string }) {
  return (
    <span className="cf-light">
      <span className={`cf-led cf-led-${state}`} />
      {label}
    </span>
  );
}

interface ReadoutProps {
  label: string;
  unit: string;
  text: string;
  led: Led;
  meter: MeterProps;
}

function Readout({ label, unit, text, led, meter }: ReadoutProps) {
  return (
    <section className={`cf-inset cf-cell cf-cell-${led}`}>
      <div className="cf-brand">
        {label} <span className="cf-unit">{unit}</span>
      </div>
      <div className="cf-readout">{text}</div>
      <Meter {...meter} />
    </section>
  );
}

/**
 * Engine dash in the Cassette Futurism style (NovusGFX Retro Design System,
 * style 15, github.com/NovusGFX/retro-design-system, MIT): amber phosphor on
 * scorched brown, LCD readouts, stepped meters, analog warning lights. Shows
 * RPM, boost, coolant, AFR and battery (see ../engineReadings.ts).
 */
export default function CassetteDashboard({ isConnected }: { isConnected: boolean }) {
  const { rpm, boost, coolant, afr, battery } = useEngineReadings(isConnected);

  return (
    <div className="cf-dash">
      <div className="cf-terminal">
        <header className="cf-head">
          <div>
            {/* Set in the LCD font: Orbitron has no Latvian letters (Š, Ķ). */}
            <div className="cf-brand cf-brand-lcd">Šķieneru Sniegums Engine Management Systems</div>
            <h1 className="cf-title">ENGINE</h1>
          </div>
          <div className="cf-status">
            <Light state={isConnected ? 'ok' : 'warn'} label="ECU LINK" />
            <Light state={coolantLed(coolant)} label="COOLANT" />
            <Light state={afrLed(afr)} label="AFR" />
            <Light state={batteryLed(battery)} label="CHARGE" />
          </div>
        </header>

        <section className={`cf-inset cf-rpm cf-cell-${rpmLed(rpm)}`}>
          <div className="cf-rpm-readout">
            <div className="cf-brand">
              ENGINE SPEED <span className="cf-unit">RPM</span>
            </div>
            <div className="cf-readout cf-readout-xl">{fmt.rpm(rpm)}</div>
          </div>
          <Meter value={rpm} {...LIMITS.rpm} segments={32} stepped />
        </section>

        <div className="cf-grid">
          <Readout
            label="BOOST"
            unit="BAR"
            text={fmt.boost(boost)}
            led={boostLed(boost)}
            meter={{ value: boost, ...LIMITS.boost, segments: 12 }}
          />
          <Readout
            label="COOLANT"
            unit="°C"
            text={fmt.coolant(coolant)}
            led={coolantLed(coolant)}
            meter={{ value: coolant, ...LIMITS.coolant, red: LIMITS.coolant.warn, segments: 12 }}
          />
          <Readout
            label="AIR/FUEL"
            unit="AFR"
            text={fmt.afr(afr)}
            led={afrLed(afr)}
            meter={{ value: afr, min: LIMITS.afr.min, max: LIMITS.afr.max, red: LIMITS.afr.okHigh, segments: 12 }}
          />
          <Readout
            label="BATTERY"
            unit="VOLT"
            text={fmt.battery(battery)}
            led={batteryLed(battery)}
            meter={{ value: battery, min: LIMITS.battery.min, max: LIMITS.battery.max, red: LIMITS.battery.high, segments: 12 }}
          />
        </div>
      </div>
      <div className="cf-scanlines" />
      <div className="cf-vignette" />
    </div>
  );
}
