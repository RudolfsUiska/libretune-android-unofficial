import { DashFileInfo } from './dashTypes';

/**
 * Dashboards drawn by code rather than loaded from a .dash/.ltdash.xml file.
 * They appear in the dashboard selector like any other, under "Built-in".
 */
export const CASSETTE_DASH_PATH = 'builtin:cassette-futurism';
export const MONTEGO_DASH_PATH = 'builtin:montego-lcd';
export const CS16_DASH_PATH = 'builtin:cs16';

export const BUILTIN_DASHES: DashFileInfo[] = [
  { name: 'Cassette Futurism', path: CASSETTE_DASH_PATH, category: 'Built-in' },
  { name: 'Montego LCD', path: MONTEGO_DASH_PATH, category: 'Built-in' },
  { name: 'CS 1.6', path: CS16_DASH_PATH, category: 'Built-in' },
];

export const isBuiltinDash = (path: string) => path.startsWith('builtin:');
