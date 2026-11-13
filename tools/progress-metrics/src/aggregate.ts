import type { BodyEvent } from './body.ts';
import { escapeEpisodes } from './episodes.ts';
import { failureCount, failureTally } from './failures.ts';
import { type InvSample, inventoryMetrics, LADDER } from './inventory.ts';
import type { PaperEvent } from './paper.ts';
import { type PosSample, positionMetrics, stillNote } from './positions.ts';
import { HIGH_CORRECTIONS, RUBBER_MIN_LINES, RUBBER_SHARE } from './stalldiag.ts';
import { journalMetrics, type Thought } from './thoughts.ts';

export type Inputs = {
  paper: PaperEvent[];
  body: BodyEvent[];
  positions: PosSample[];
  inventory: InvSample[];
  thoughts: Thought[];
  /** Journal lines from before a cut: look-back for the repeated-journal share only. */
  thoughtContext?: Thought[];
};

export type AggregateOptions = {
  /** Windows with fewer events than this are reported as insufficient data. */
  minEvents?: number;
  /** Name of the single window (named-window runs). */
  name?: string;
  /** Forces the span [start, end) instead of the span of the data. */
  range?: { start: number; end: number };
  /** Agents to give a row even if they have no data in the span. */
  agents?: string[];
};

export const DEFAULT_MIN_EVENTS = 5;

export type Row = {
  agent: string;
  windowStart: number;
  windowEnd: number;
  /** Name from a --windows file, else empty. */
  window: string;
  /** Events of the agent in the window (paper, body, position, journal). */
  events: number;
  /** First and last event time actually covered; empty without events. */
  dataFrom: string;
  dataTo: string;
  /** 1 when events is under the minimum: the rates are not meaningful. */
  insufficient: number;
  forcedMoves: number;
  maxCorrections10s: number | null;
  /** Stall lines with corrections_10s >= 10 over stall lines that carry a corrections value. */
  highCorrectionShare: number | null;
  rubberBanding: string;
  rungLines: number;
  rungTried: string;
  positionNote: string;
  deaths: number;
  deathCauses: string;
  deathsPerHour: number;
  joins: number;
  leaves: number;
  chat: number;
  actions: number;
  outcomes: string;
  /** Failed actions in the window (action_failed lines, each counted with its repeats). */
  actionFailed: number;
  /** The same failures grouped as do/reason=count. */
  actionFailures: string;
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
export function aggregate(inp: Inputs, windowMs: number, opts: AggregateOptions = {}): Row[] {
  const minEvents = opts.minEvents ?? DEFAULT_MIN_EVENTS;
  const times: number[] = [
    ...inp.paper.map((e) => e.at),
    ...inp.body.flatMap((e) => (e.at === null ? [] : [e.at])),
    ...inp.positions.map((e) => e.at),
    ...inp.inventory.map((e) => e.at),
    ...inp.thoughts.map((e) => e.at),
  ];
  if (times.length === 0 && !opts.range) return [];
  const t0 = opts.range ? opts.range.start : Math.min(...times);
  const t1 = opts.range ? opts.range.end : Math.max(...times) + 1;
  const width = windowMs > 0 ? windowMs : t1 - t0;
  // A tail under a quarter of a window joins the last full window instead of making a sliver of its own.
  const whole = Math.floor((t1 - t0) / width);
  const tail = t1 - t0 - whole * width;
  const count = Math.max(1, tail >= width / 4 ? whole + 1 : whole);
  const win = (at: number | null): number =>
    at === null ? 0 : Math.min(count - 1, Math.floor((at - t0) / width));

  const agents = new Set<string>(opts.agents ?? []);
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
      const failed = body.filter((e) => e.kind === 'action_failed');
      const rungs = body.filter((e) => e.kind === 'escape_rung');
      const worked = rungs.filter((e) => e.worked);
      const ep = escapeEpisodes(
        inp.body.filter((e) => e.agent === agent),
        inp.positions.filter((e) => e.agent === agent),
        (at) => win(at) === w,
      );
      const pm = positionMetrics(pos);
      const before = [...(inp.thoughtContext ?? []), ...inp.thoughts]
        .filter((e) => e.agent === agent && e.at < ws && !(w > 0 && win(e.at) === w))
        .sort((a, b) => a.at - b.at);
      const jm = journalMetrics(th, before);
      const stalls = body.filter((e) => e.kind === 'stall_diag');
      const corr = stalls.flatMap((e) =>
        e.diag?.corrections10s == null ? [] : [e.diag.corrections10s],
      );
      const high = corr.filter((c) => c >= HIGH_CORRECTIONS).length;
      const highShare = share(high, corr.length);
      const evTimes = [
        ...paper.map((e) => e.at),
        ...body.flatMap((e) => (e.at === null ? [] : [e.at])),
        ...pos.map((e) => e.at),
        ...th.map((e) => e.at),
      ];
      const events = paper.length + body.length + pos.length + th.length;
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
        window: opts.name ?? '',
        events,
        dataFrom: evTimes.length === 0 ? '' : new Date(Math.min(...evTimes)).toISOString(),
        dataTo: evTimes.length === 0 ? '' : new Date(Math.max(...evTimes)).toISOString(),
        insufficient: events < minEvents ? 1 : 0,
        forcedMoves: body.filter((e) => e.kind === 'forced_move').length,
        maxCorrections10s: corr.length === 0 ? null : Math.max(...corr),
        highCorrectionShare: highShare,
        rubberBanding:
          corr.length >= RUBBER_MIN_LINES && (highShare ?? 0) >= RUBBER_SHARE
            ? 'rubber-banding'
            : '',
        rungLines: rungs.length,
        rungTried: fmt(tally(rungs.map((r) => r.reason))),
        positionNote: stillNote(pm),
        deaths: deaths.length,
        deathCauses: fmt(tally(deaths.map((d) => d.cause))),
        deathsPerHour: deaths.length / ((we - ws) / 3_600_000),
        joins: paper.filter((e) => e.kind === 'join').length,
        leaves: paper.filter((e) => e.kind === 'leave').length,
        chat: paper.filter((e) => e.kind === 'chat').length,
        actions: actions.length,
        outcomes: fmt(tally(actions.map((a) => a.reason))),
        actionFailed: failed.reduce((n, e) => n + failureCount(e), 0),
        actionFailures: fmt(failureTally(failed)),
        noEffectShare: share(
          actions.filter((a) => a.reason === 'no_effect').length,
          actions.length,
        ),
        stallDiag: stalls.length,
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
