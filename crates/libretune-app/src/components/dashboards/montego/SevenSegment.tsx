/**
 * Seven-segment LCD digits, with the unlit segments faintly visible as on a
 * real LCD. Segments a-g run: a top, b upper right, c lower right, d bottom,
 * e lower left, f upper left, g middle.
 */

export const SEGMENTS_FOR: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

export interface Cell {
  segments: string;
  dp: boolean;
}

/**
 * Split text into digit cells, a '.' lighting the decimal point of the digit
 * before it, right-aligned into `digits` cells (blank cells still show their
 * unlit segments). Characters with no segment pattern are blank.
 */
export function toCells(text: string, digits: number): Cell[] {
  const cells: Cell[] = [];
  for (const ch of text) {
    if (ch === '.' && cells.length > 0) {
      cells[cells.length - 1].dp = true;
    } else {
      cells.push({ segments: SEGMENTS_FOR[ch] ?? '', dp: false });
    }
  }
  while (cells.length < digits) cells.unshift({ segments: '', dp: false });
  return cells.slice(-digits);
}

// Digit cell geometry in its own units: 60 wide, 100 high; scaled to fit.
const W = 60;
const H = 100;
const T = 11; // segment thickness
const G = 2; // gap between segments

/** Digit width for a given height (the cell's aspect ratio). */
export const digitWidth = (h: number) => (h * W) / H;

function hSeg(y: number): string {
  const x0 = T / 2 + G;
  const x1 = W - T / 2 - G;
  const h = T / 2;
  return `${x0},${y} ${x0 + h},${y - h} ${x1 - h},${y - h} ${x1},${y} ${x1 - h},${y + h} ${x0 + h},${y + h}`;
}

function vSeg(x: number, y0: number, y1: number): string {
  const h = T / 2;
  const a = y0 + G;
  const b = y1 - G;
  return `${x},${a} ${x + h},${a + h} ${x + h},${b - h} ${x},${b} ${x - h},${b - h} ${x - h},${a + h}`;
}

const SEGMENT_POINTS: Record<string, string> = {
  a: hSeg(T / 2),
  b: vSeg(W - T / 2, T / 2, H / 2),
  c: vSeg(W - T / 2, H / 2, H - T / 2),
  d: hSeg(H - T / 2),
  e: vSeg(T / 2, H / 2, H - T / 2),
  f: vSeg(T / 2, T / 2, H / 2),
  g: hSeg(H / 2),
};

interface Props {
  text: string;
  /** Number of digit cells; the text is right-aligned into them. */
  digits: number;
  /** Top-left of the first cell, cell height and cell advance, in the parent SVG's units. */
  x: number;
  y: number;
  h: number;
  pitch: number;
  className?: string;
}

/**
 * LCD digits as an SVG group, placed in the parent SVG's coordinates so they
 * can sit on its grid. Colour comes from CSS `color`; lit segments have class
 * `lit`, unlit ones `unlit`.
 */
export function SevenSegment({ text, digits, x, y, h, pitch, className }: Props) {
  const k = h / H;
  return (
    <g className={`seg7 ${className ?? ''}`} role="img" aria-label={text.trim()}>
      {toCells(text, digits).map((cell, i) => (
        // skewX leans the digit; shifting by the lean keeps its base on the cell.
        <g key={i} transform={`translate(${x + i * pitch + h * 0.1} ${y}) scale(${k}) skewX(-6)`}>
          {Object.entries(SEGMENT_POINTS).map(([seg, points]) => (
            <polygon key={seg} points={points} className={cell.segments.includes(seg) ? 'lit' : 'unlit'} />
          ))}
          <circle cx={W + 9} cy={H - T / 2} r={T / 2} className={cell.dp ? 'lit' : 'unlit'} />
        </g>
      ))}
    </g>
  );
}
