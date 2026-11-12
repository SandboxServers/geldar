import { DARK_RANGE, NEAR_SOLID, type Ray, type ViewGrid } from './viewport.ts';

/** The words of the text viewport (view-tool packet): a summary, bands, an enclosure read and a small grid. */

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

type VBand = 'up' | 'level' | 'down';
type HBand = 'left' | 'ahead' | 'right';
const V_BANDS: readonly VBand[] = ['up', 'level', 'down'];
const H_BANDS: readonly HBand[] = ['left', 'ahead', 'right'];
const H_WORDS: Record<HBand, string> = {
  left: 'on the left',
  ahead: 'ahead',
  right: 'on the right',
};

/** The compass point a yaw faces (mineflayer's convention: yaw 0 north, pi/2 west). */
export function compassOf(yaw: number): string {
  const bearing = Math.atan2(-Math.sin(yaw), Math.cos(yaw));
  const degrees = ((((bearing * 180) / Math.PI) % 360) + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8] ?? 'north';
}

function pitchWords(pitch: number): string {
  const degrees = (pitch * 180) / Math.PI;
  if (Math.abs(degrees) < 8) return 'level';
  const amount = Math.abs(degrees) < 25 ? 'slightly ' : '';
  return `${amount}${degrees > 0 ? 'up' : 'down'}`;
}

function bandOf(grid: ViewGrid, row: number, col: number): { v: VBand; h: HBand } {
  const v: VBand = row < grid.rows / 3 ? 'up' : row >= (2 * grid.rows) / 3 ? 'down' : 'level';
  const h: HBand = col < grid.cols / 3 ? 'left' : col >= (2 * grid.cols) / 3 ? 'right' : 'ahead';
  return { v, h };
}

function blocks(distance: number): string {
  const n = Math.max(1, Math.round(distance));
  return n === 1 ? '1 block' : `${n} blocks`;
}

/** What one ray says for a band's list, or undefined for plain air (nothing to name). */
function labelOf(ray: Ray): string | undefined {
  switch (ray.kind) {
    case 'air':
      return undefined;
    case 'unknown':
      return 'unknown (not loaded)';
    case 'dark':
      return `too dark past ${DARK_RANGE} blocks`;
    default:
      return ray.name ?? ray.kind;
  }
}

/** The bands: each direction band with its nearest things, most near first, at most three named. */
function bandLines(grid: ViewGrid): string[] {
  const lines: string[] = [];
  for (const v of V_BANDS) {
    for (const h of H_BANDS) {
      const found = new Map<string, number>();
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
          const band = bandOf(grid, row, col);
          const ray = grid.rays[row]?.[col];
          if (band.v !== v || band.h !== h || ray === undefined) continue;
          const label = labelOf(ray);
          if (label === undefined) continue;
          const at = ray.distance ?? 0;
          found.set(label, Math.min(found.get(label) ?? Infinity, at));
        }
      }
      const nearest = [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3);
      const body =
        nearest.length === 0
          ? 'open air'
          : nearest.map(([label, at]) => `${label} ${blocks(at)}`).join('; ');
      lines.push(`- ${v} ${H_WORDS[h]}: ${body}`);
    }
  }
  return lines;
}

/** The enclosure read: solid within NEAR_SOLID blocks on every ray, or the gaps where it is not. */
function enclosureLine(grid: ViewGrid): string {
  let counted = 0;
  const gaps = new Map<VBand, Set<HBand>>();
  let unknown = false;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const ray = grid.rays[row]?.[col];
      if (ray === undefined) continue;
      if (ray.kind === 'unknown') unknown = true;
      if (ray.kind === 'unknown' || ray.kind === 'dark') continue;
      counted++;
      if (ray.solidDistance !== undefined && ray.solidDistance <= NEAR_SOLID) continue;
      const { v, h } = bandOf(grid, row, col);
      const set = gaps.get(v) ?? new Set<HBand>();
      set.add(h);
      gaps.set(v, set);
    }
  }
  const note = unknown ? ' Part of the view is not loaded.' : '';
  if (counted === 0) return `Too dark or not loaded to tell whether it is enclosed.${note}`;
  const gapCount = [...gaps.values()].reduce((sum, set) => sum + set.size, 0);
  if (gapCount === 0)
    return `Enclosed: solid within ${NEAR_SOLID} blocks everywhere in view.${note}`;
  const gapRays = countGapRays(grid);
  if (gapRays / counted >= 0.6)
    return `Open: nothing solid within ${NEAR_SOLID} blocks over most of the view.${note}`;
  const phrases = V_BANDS.filter((v) => gaps.has(v)).map((v) => {
    const set = gaps.get(v) ?? new Set<HBand>();
    return set.size === 3 ? v : `${v} ${[...set].map((h) => H_WORDS[h]).join(' and ')}`;
  });
  return `Enclosed except for a gap ${phrases.join(' and ')}.${note}`;
}

function countGapRays(grid: ViewGrid): number {
  let gapRays = 0;
  for (const line of grid.rays) {
    for (const ray of line) {
      if (ray.kind === 'unknown' || ray.kind === 'dark') continue;
      if (ray.solidDistance === undefined || ray.solidDistance > NEAR_SOLID) gapRays++;
    }
  }
  return gapRays;
}

const GLYPH: Record<Ray['kind'], string> = {
  air: '.',
  solid: '#',
  water: '~',
  leaves: 'L',
  glass: 'G',
  mob: 'M',
  unknown: '?',
  dark: 'd',
};

/** The grid as text: one character per ray, top row first, with the legend under it. */
function gridLines(grid: ViewGrid): string[] {
  const rows = grid.rays.map((line) => line.map((ray) => GLYPH[ray.kind]).join(''));
  return [
    `Grid (${grid.cols} columns, top row first):`,
    ...rows,
    'Legend: . air  # solid  ~ water or lava  L leaves  G glass  M mob  ? not loaded  d too dark past ' +
      `${DARK_RANGE} blocks`,
  ];
}

/** The viewport as text for the agent: the facing and pitch, the enclosure read, the bands, and the grid. */
export function describeView(grid: ViewGrid): string {
  const head = `Facing ${compassOf(grid.yaw)}, looking ${pitchWords(grid.pitch)}.`;
  return [
    head,
    enclosureLine(grid),
    'Within the view:',
    ...bandLines(grid),
    ...gridLines(grid),
  ].join('\n');
}
