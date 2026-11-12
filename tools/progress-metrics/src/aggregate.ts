import type { BodyEvent } from './body.ts';
import { escapeEpisodes } from './episodes.ts';
import { type InvSample, inventoryMetrics, LADDER } from './inventory.ts';
import type { PaperEvent } from './paper.ts';
import { type PosSample, positionMetrics } from './positions.ts';
import { journalMetrics, type Thought } from './thoughts.ts';

export type Inputs = {
  paper: PaperEvent[];
  body: BodyEvent[];
  positions: PosSample[];
  inventory: InvSample[];
  thoughts: Thought[];
};

export type Row = {
  agent: string;
  windowStart: number;
  windowEnd: number;
  deaths: number;
  deathCauses: string;
  deathsPerHour: number;
  joins: number;
  leaves: number;
  chat: number;
  actions: number;
  outcomes: string;
  noEffectShare: number | null;
  stallDiag: number;
  rungWorked: string;
  escapeSuccessRate: number | null;
  episodes: number;
  episodesEscaped: number;
  episodeSuccessRate: number | null;
  watchdog: number;
  eats: number;
  restarts: number;
  shortSessions: number;
  distance: number;
  chunks: number;
  stuckSeconds: number;
  escapeSeconds: number | null;
  journalEntries: number;
  repeatedJournalShare: number | null;
  asleepEntries: number;
  distinctItems: number;
  timeToFirstToolMin: number | null;
  firstSeenMin: string;
};

function tally(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

const fmt = (m: Map<string, number>): string =>
  [...m]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');

const share = (n: number, d: number): number | null => (d === 0 ? null : n / d);

/**
 * One row per agent and window. `windowMs` of 0 makes a single window over all data. Body events with no
 * time go to the first window. Time-to-first-tool and first-seen are measured from the agent's first
 * inventory sample over its whole run, and shown in the window that holds the first tool.
 */
export function aggregate(inp: Inputs, windowMs: number): Row[] {
  const times: number[] = [
    ...inp.paper.map((e) => e.at),
    ...inp.body.flatMap((e) => (e.at === null ? [] : [e.at])),
    ...inp.positions.map((e) => e.at),
    ...inp.inventory.map((e) => e.at),
    ...inp.thoughts.map((e) => e.at),
  ];
  if (times.length === 0) return [];
  const t0 = Math.min(...times);
  const t1 = Math.max(...times) + 1;
  const width = windowMs > 0 ? windowMs : t1 - t0;
  // A tail under a quarter of a window joins the last full window instead of making a sliver of its own.
  const whole = Math.floor((t1 - t0) / width);
  const tail = t1 - t0 - whole * width;
  const count = Math.max(1, tail >= width / 4 ? whole + 1 : whole);
  const win = (at: number | null): number =>
    at === null ? 0 : Math.min(count - 1, Math.floor((at - t0) / width));

  const agents = new Set<string>();
  for (const l of [inp.paper, inp.body, inp.positions, inp.inventory, inp.thoughts]) {
    for (const e of l) agents.add(e.agent);
  }
  const rows: Row[] = [];
  for (const agent of [...agents].sort()) {
    const inv = inp.inventory.filter((s) => s.agent === agent);
    const invAll = inventoryMetrics(inv);
    for (let w = 0; w < count; w++) {
      const ws = t0 + w * width;
      const we = w === count - 1 ? t1 : ws + width;
      const paper = inp.paper.filter((e) => e.agent === agent && win(e.at) === w);
      const body = inp.body.filter((e) => e.agent === agent && win(e.at) === w);
      const pos = inp.positions.filter((e) => e.agent === agent && win(e.at) === w);
      const th = inp.thoughts.filter((e) => e.agent === agent && win(e.at) === w);
      const deaths = paper.filter((e) => e.kind === 'death');
      const actions = body.filter((e) => e.kind === 'action');
      const rungs = body.filter((e) => e.kind === 'escape_rung');
      const worked = rungs.filter((e) => e.worked);
      const ep = escapeEpisodes(
        inp.body.filter((e) => e.agent === agent),
        inp.positions.filter((e) => e.agent === agent),
        (at) => win(at) === w,
      );
      const pm = positionMetrics(pos);
      const jm = journalMetrics(th);
      const invWin = inv.filter((s) => win(s.at) === w);
      const toolAt = invAll.firstToolAt;
      const hasTool = toolAt !== null && win(toolAt) === w;
      const firstSeen = LADDER.flatMap((k) => {
        const at = invAll.firstSeen[k];
        return at !== undefined && win(at) === w && invAll.firstSampleAt !== null
          ? [`${k}=${((at - invAll.firstSampleAt) / 60000).toFixed(1)}`]
          : [];
      });
      rows.push({
        agent,
        windowStart: ws,
        windowEnd: we,
        deaths: deaths.length,
        deathCauses: fmt(tally(deaths.map((d) => d.cause))),
        deathsPerHour: deaths.length / ((we - ws) / 3_600_000),
        joins: paper.filter((e) => e.kind === 'join').length,
        leaves: paper.filter((e) => e.kind === 'leave').length,
        chat: paper.filter((e) => e.kind === 'chat').length,
        actions: actions.length,
        outcomes: fmt(tally(actions.map((a) => a.reason))),
        noEffectShare: share(
          actions.filter((a) => a.reason === 'no_effect').length,
          actions.length,
        ),
        stallDiag: body.filter((e) => e.kind === 'stall_diag').length,
        rungWorked: fmt(tally(worked.map((r) => r.reason))),
        escapeSuccessRate: share(worked.length, rungs.length),
        episodes: ep.episodes,
        episodesEscaped: ep.escaped,
        episodeSuccessRate: share(ep.escaped, ep.episodes),
        watchdog: body.filter((e) => e.kind === 'body_watchdog').length,
        eats: body.filter((e) => e.kind === 'eat').length,
        restarts: body.filter((e) => e.kind === 'body_restart').length,
        shortSessions: body.filter((e) => e.kind === 'short_session').length,
        distance: pm.distance,
        chunks: pm.chunks,
        stuckSeconds: pm.stuckMs / 1000,
        escapeSeconds: pm.escapeMs === null ? null : pm.escapeMs / 1000,
        journalEntries: jm.entries,
        repeatedJournalShare: share(jm.nearDuplicates, jm.entries),
        asleepEntries: jm.asleep,
        distinctItems: new Set(
          invWin.flatMap((s) => [...s.items].filter(([, n]) => n > 0).map(([k]) => k)),
        ).size,
        timeToFirstToolMin:
          hasTool && invAll.firstSampleAt !== null ? (toolAt - invAll.firstSampleAt) / 60000 : null,
        firstSeenMin: firstSeen.join(' '),
      });
    }
  }
  return rows;
}
