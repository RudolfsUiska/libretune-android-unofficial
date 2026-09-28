import { useChannels } from '../../stores/realtimeStore';

/**
 * The engine readings the retro dashboards show - RPM, boost, coolant, AFR
 * and battery - with their meter ranges and warning limits. Shared by the
 * Cassette Futurism and Montego LCD dashes; everything here is not styling.
 */

/** Meter ranges and warning limits. Edit here to suit the engine. */
export const LIMITS = {
  rpm: { min: 0, max: 8000, red: 6500 },
  /** Boost is gauge pressure in bar: MAP minus barometric pressure. */
  boost: { min: -1, max: 2, red: 1.5 },
  coolant: { min: 40, max: 120, caution: 100, warn: 105 },
  /** Outside this band the AFR light goes amber (not red: a lift-off reads lean). */
  afr: { min: 10, max: 20, okLow: 10.5, okHigh: 16.5 },
  battery: { min: 10, max: 16, low: 11.8, high: 15.2 },
} as const;

/** Standard atmosphere, when the ECU reports no barometric pressure. */
export const STANDARD_BARO_KPA = 101.325;

/** Channel names to read, first present wins: rusEFI first, then Speeduino. */
export const CHANNELS = {
  rpm: ['RPMValue', 'rpm', 'RPM'],
  map: ['MAPValue', 'map', 'MAP'],
  baro: ['baroPressure', 'baro'],
  coolant: ['coolant', 'CLTValue', 'clt'],
  afr: ['AFRValue', 'afr', 'AFR'],
  battery: ['VBatt', 'batteryVoltage', 'vBatt'],
} as const;

export const ALL_CHANNEL_NAMES: string[] = Object.values(CHANNELS).flat();

/** First present channel value, or undefined when the ECU sends none. */
export function pick(values: Record<string, number>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const v = values[name];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Boost in bar from MAP and baro (kPa); vacuum is negative. */
export function boostBar(mapKpa: number, baroKpa: number | undefined): number {
  const baro = baroKpa !== undefined && baroKpa > 50 ? baroKpa : STANDARD_BARO_KPA;
  return (mapKpa - baro) / 100;
}

/** How many of `count` meter segments are lit for a value in [min, max]. */
export function litSegments(value: number, min: number, max: number, count: number): number {
  const frac = (value - min) / (max - min);
  return Math.max(0, Math.min(count, Math.round(frac * count)));
}

/** Index of the first red segment for a threshold in [min, max]. */
export function redFromSegment(threshold: number, min: number, max: number, count: number): number {
  return Math.max(0, Math.min(count, Math.ceil(((threshold - min) / (max - min)) * count)));
}

/** Warning-light state, as on the design system's status bar. */
export type Led = 'ok' | 'caution' | 'warn' | 'off';

export function coolantLed(c: number | undefined): Led {
  if (c === undefined) return 'off';
  if (c >= LIMITS.coolant.warn) return 'warn';
  if (c >= LIMITS.coolant.caution) return 'caution';
  return 'ok';
}

export function afrLed(afr: number | undefined): Led {
  if (afr === undefined) return 'off';
  return afr < LIMITS.afr.okLow || afr > LIMITS.afr.okHigh ? 'caution' : 'ok';
}

export function batteryLed(v: number | undefined): Led {
  if (v === undefined) return 'off';
  return v < LIMITS.battery.low || v > LIMITS.battery.high ? 'warn' : 'ok';
}

export function rpmLed(rpm: number | undefined): Led {
  if (rpm === undefined) return 'off';
  return rpm >= LIMITS.rpm.red ? 'warn' : 'ok';
}

export function boostLed(bar: number | undefined): Led {
  if (bar === undefined) return 'off';
  return bar >= LIMITS.boost.red ? 'warn' : 'ok';
}

/** LCD-style readouts; dashes when there is no value. */
export const fmt = {
  rpm: (v: number | undefined) => (v === undefined ? '----' : String(Math.round(v)).padStart(4, '0')),
  boost: (v: number | undefined) =>
    v === undefined ? '-.--' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`,
  coolant: (v: number | undefined) => (v === undefined ? '---' : String(Math.round(v))),
  afr: (v: number | undefined) => (v === undefined ? '--.-' : v.toFixed(1)),
  battery: (v: number | undefined) => (v === undefined ? '--.-' : v.toFixed(1)),
};

export interface EngineReadings {
  rpm: number | undefined;
  /** Gauge pressure in bar (vacuum negative). */
  boost: number | undefined;
  coolant: number | undefined;
  afr: number | undefined;
  battery: number | undefined;
}

/**
 * Current readings, each undefined when the ECU sends no such channel. A
 * dropped link leaves stale values in the store, so while disconnected every
 * reading is undefined and the dashes show dashes instead.
 */
export function useEngineReadings(isConnected: boolean): EngineReadings {
  const values = useChannels(ALL_CHANNEL_NAMES);
  const read = (names: readonly string[]) => (isConnected ? pick(values, names) : undefined);
  const map = read(CHANNELS.map);
  return {
    rpm: read(CHANNELS.rpm),
    boost: map === undefined ? undefined : boostBar(map, read(CHANNELS.baro)),
    coolant: read(CHANNELS.coolant),
    afr: read(CHANNELS.afr),
    battery: read(CHANNELS.battery),
  };
}
