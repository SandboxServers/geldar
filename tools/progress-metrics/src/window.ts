import type { Inputs } from './aggregate.ts';

export type NamedWindow = { name: string; start: number; end: number };

/** How many journal lines before a cut are kept as look-back for the repeated-journal share. */
const LOOKBACK = 20;

/** `[{"name":"W1","start":"<iso>","end":"<iso>"}]`: start inclusive, end exclusive. Throws on a bad list. */
export function parseWindows(json: string): NamedWindow[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data) || data.length === 0) throw new Error('windows: want a non-empty list');
  return data.map((w, i) => {
    const r = (typeof w === 'object' && w !== null ? w : {}) as Record<string, unknown>;
    const start = typeof r.start === 'string' ? Date.parse(r.start) : Number.NaN;
    const end = typeof r.end === 'string' ? Date.parse(r.end) : Number.NaN;
    if (typeof r.name !== 'string' || r.name === '' || Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`windows[${i}]: want name, ISO start and ISO end`);
    }
    if (end <= start) throw new Error(`windows[${i}]: end must be after start`);
    return { name: r.name, start, end };
  });
}

/**
 * Cuts every input stream to [since, until). Body events without a time cannot be placed and are dropped
 * when a cut is given. Thoughts before `since` are kept apart as `thoughtContext` (look-back only).
 */
export function cutInputs(inp: Inputs, since: number | null, until: number | null): Inputs {
  if (since === null && until === null) return inp;
  const lo = since ?? Number.NEGATIVE_INFINITY;
  const hi = until ?? Number.POSITIVE_INFINITY;
  const inside = (at: number | null): boolean => at !== null && at >= lo && at < hi;
  const pre = [...(inp.thoughtContext ?? []), ...inp.thoughts.filter((t) => t.at < lo)].sort(
    (a, b) => a.at - b.at,
  );
  const ctx: Inputs['thoughts'] = [];
  const perAgent = new Map<string, number>();
  for (const t of pre.reverse()) {
    const n = perAgent.get(t.agent) ?? 0;
    if (n >= LOOKBACK) continue;
    perAgent.set(t.agent, n + 1);
    ctx.push(t);
  }
  return {
    paper: inp.paper.filter((e) => inside(e.at)),
    body: inp.body.filter((e) => inside(e.at)),
    positions: inp.positions.filter((e) => inside(e.at)),
    inventory: inp.inventory.filter((e) => inside(e.at)),
    thoughts: inp.thoughts.filter((e) => inside(e.at)),
    thoughtContext: ctx,
  };
}
