import type { BodyEvent } from './body.ts';
import type { PosSample } from './positions.ts';

export type EpisodeStats = { episodes: number; escaped: number };

/** Moving this far (blocks, horizontal) from where the stall was seen counts as having got out. */
export const ESCAPE_DISTANCE = 4;
/** A position change is only looked for this long after a stall starts. */
export const ESCAPE_LOOKAHEAD_MS = 5 * 60_000;

/**
 * Escape episodes of one agent. A `stall_diag` with reason `stall` starts an episode; it ends at the next
 * such line. It succeeded if an escape-ladder rung reported `worked: true` before it ended, or a position
 * sample within 5 minutes (and before it ended) is 4 or more blocks from the first sample at or after the
 * stall. `events` and `pos` are the agent's whole run, so an episode is not cut by a window; the stall's own
 * time decides the window it is counted in, which the caller does by passing `stallsIn`.
 * Events without a time cannot start an episode.
 */
export function escapeEpisodes(
  events: BodyEvent[],
  pos: PosSample[],
  stallsIn: (at: number) => boolean,
): EpisodeStats {
  const timed = events.flatMap((e) => (e.at === null ? [] : [{ ...e, at: e.at }]));
  const starts = timed
    .filter((e) => e.kind === 'stall_diag' && e.reason === 'stall')
    .map((e) => e.at)
    .sort((a, b) => a - b);
  const rungs = timed.filter((e) => e.kind === 'escape_rung' && e.worked).map((e) => e.at);
  const sorted = [...pos].sort((a, b) => a.at - b.at);
  let escaped = 0;
  let episodes = 0;
  for (const [i, start] of starts.entries()) {
    if (!stallsIn(start)) continue;
    episodes++;
    const end = starts[i + 1] ?? Number.POSITIVE_INFINITY;
    if (rungs.some((r) => r >= start && r < end)) {
      escaped++;
      continue;
    }
    const first = sorted.find((p) => p.at >= start);
    if (
      first &&
      sorted.some(
        (p) =>
          p.at > first.at &&
          p.at < end &&
          p.at <= start + ESCAPE_LOOKAHEAD_MS &&
          Math.hypot(p.x - first.x, p.z - first.z) >= ESCAPE_DISTANCE,
      )
    )
      escaped++;
  }
  return { episodes, escaped };
}
