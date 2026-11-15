/**
 * The muffled-voice lines of the perception snapshot (MH-4, decision 0199 steps 6 and 8).
 *
 * Rules, all deterministic:
 * - Collapse by direction. The ten direction codes (eight compass points, `overhead`, `below`) are ten separate
 *   keys; `overhead` and `below` are never merged into a compass point. Each direction keeps the nearest band it
 *   heard (near, then mid, then far).
 * - At most `MUFFLED_LINE_CAP` lines. The nearest bands come first. Ties on band are broken by `DIRECTION_ORDER`
 *   (n, ne, e, se, s, sw, w, nw, overhead, below), so the same notices always render the same lines.
 * - Each line is `heardMuffledSentence(direction, band)` and nothing else. A code outside the ten directions or
 *   the three bands is refused: it is skipped, never shown.
 *
 * Band distances are not computed here. The plugin sends the band, so golem's `bandOf` (which stops at 24) is not used.
 */
import { heardMuffledSentence } from '@geldar/contract';

/** Most muffled lines in one snapshot. */
export const MUFFLED_LINE_CAP = 3;

/** The ten direction codes, in tie order. */
export const DIRECTION_ORDER: readonly string[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
  'overhead',
  'below',
];

/** The three bands, nearest first. */
export const BAND_ORDER: readonly string[] = ['near', 'mid', 'far'];

/** The sentences for the notices given, collapsed by direction and capped (see the file header). */
export function renderMuffledLines(
  notices: readonly { direction: string; band: string }[],
): string[] {
  const nearest = new Map<string, number>();
  for (const notice of notices) {
    const direction = DIRECTION_ORDER.indexOf(notice.direction) < 0 ? undefined : notice.direction;
    const band = BAND_ORDER.indexOf(notice.band);
    if (direction === undefined || band < 0) continue;
    const kept = nearest.get(direction);
    if (kept === undefined || band < kept) nearest.set(direction, band);
  }
  return [...nearest.entries()]
    .sort(
      ([directionA, bandA], [directionB, bandB]) =>
        bandA - bandB || DIRECTION_ORDER.indexOf(directionA) - DIRECTION_ORDER.indexOf(directionB),
    )
    .slice(0, MUFFLED_LINE_CAP)
    .map(([direction, band]) => heardMuffledSentence(direction, BAND_ORDER[band] ?? 'far'));
}
