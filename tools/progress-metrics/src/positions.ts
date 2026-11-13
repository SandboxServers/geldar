import { parseTime } from './time.ts';

export type PosSample = { agent: string; at: number; x: number; y: number; z: number };

const NUM = String.raw`(-?\d+(?:\.\d+)?)[df]?`;
const POS = new RegExp(String.raw`\[\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*\]`);

/**
 * Sampler lines are tab separated: `<iso time>\t<agent>\t<raw rcon reply>`, where the reply is
 * `ag_x has the following entity data: [12.5d, 64.0d, -3.2d]`. Anything else is skipped.
 */
export function parsePositions(text: string): PosSample[] {
  const out: PosSample[] = [];
  for (const line of text.split('\n')) {
    const [ts, agent, raw] = line.trimEnd().split('\t');
    if (!ts || !agent || !raw) continue;
    const at = parseTime(ts);
    const m = POS.exec(raw);
    if (at === null || !m) continue;
    out.push({ agent, at, x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
  }
  return out;
}

export type PosMetrics = {
  distance: number;
  chunks: number;
  /** Longest time (ms) the samples stayed inside one 3x3 block area. */
  stuckMs: number;
  /** From the start of that longest stuck stretch to the first sample outside it; null if never left. */
  escapeMs: number | null;
  samples: number;
  /** Median gap between samples in seconds; null under two samples. */
  intervalSec: number | null;
  /** Largest distance of any sample from the first one. */
  maxDisplacement: number;
};

/** An agent whose samples all stay within this many blocks of the first one did not move. */
export const MOVED_BLOCKS = 1;

/** did not move in 3 samples (every 5 s), or empty when there is movement or under two samples. */
export function stillNote(m: PosMetrics): string {
  if (m.samples < 2 || m.intervalSec === null || m.maxDisplacement >= MOVED_BLOCKS) return '';
  return `did not move in ${m.samples} samples (every ${m.intervalSec.toFixed(0)} s)`;
}

/** A jump larger than this between two samples is a teleport or respawn, not travel. */
const TELEPORT_BLOCKS = 100;
const AREA = 3;

export function positionMetrics(samples: PosSample[]): PosMetrics {
  const s = [...samples].sort((a, b) => a.at - b.at);
  let distance = 0;
  const chunks = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    const p = s[i] as PosSample;
    chunks.add(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`);
    const q = s[i - 1];
    if (q) {
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (d <= TELEPORT_BLOCKS) distance += d;
    }
  }
  let stuckMs = 0;
  let escapeMs: number | null = null;
  for (let i = 0; i < s.length; i++) {
    let minX = (s[i] as PosSample).x;
    let maxX = minX;
    let minZ = (s[i] as PosSample).z;
    let maxZ = minZ;
    let j = i + 1;
    for (; j < s.length; j++) {
      const p = s[j] as PosSample;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      if (maxX - minX >= AREA || maxZ - minZ >= AREA) break;
    }
    const dur = ((s[j - 1] as PosSample).at ?? 0) - (s[i] as PosSample).at;
    if (dur > stuckMs) {
      stuckMs = dur;
      const out = s[j];
      escapeMs = out ? out.at - (s[i] as PosSample).at : null;
    }
  }
  const gaps = s
    .slice(1)
    .map((p, i) => p.at - (s[i] as PosSample).at)
    .sort((a, b) => a - b);
  const first = s[0];
  return {
    distance,
    chunks: chunks.size,
    stuckMs,
    escapeMs,
    samples: s.length,
    intervalSec: gaps.length === 0 ? null : (gaps[Math.floor(gaps.length / 2)] as number) / 1000,
    maxDisplacement: first
      ? Math.max(...s.map((p) => Math.hypot(p.x - first.x, p.y - first.y, p.z - first.z)))
      : 0,
  };
}
