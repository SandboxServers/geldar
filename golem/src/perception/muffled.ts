/**
 * The muffled-voice notices of the perception snapshot (MH-4, decision 0199 steps 6 and 8).
 *
 * Rules, all deterministic:
 * - Collapse by direction. The ten direction codes (eight compass points, `overhead`, `below`) are ten separate
 *   keys; `overhead` and `below` are never merged into a compass point. Each direction keeps the nearest band it
 *   heard (near, then mid, then far).
 * - At most `MUFFLED_NOTICE_CAP` notices. The nearest bands come first. Ties on band are broken by `DIRECTION_ORDER`
 *   (n, ne, e, se, s, sw, w, nw, overhead, below), so the same notices always give the same list.
 * - Each notice is a `{ direction, band }` object and nothing else. A code outside the ten directions or the three
 *   bands is refused: it is skipped, never carried.
 *
 * The sentence for a notice is made by the Mind's side (`heardMuffledSentence` in the contract). Band distances are
 * not computed here. The plugin sends the band, so golem's `bandOf` (which stops at 24) is not used.
 */
import type { Snapshot } from '@geldar/contract';

/** One muffled notice as the Body's snapshot carries it (`heard_muffled`). */
export type MuffledNotice = NonNullable<Snapshot['heard_muffled']>[number];

/** Most muffled notices in one snapshot. */
export const MUFFLED_NOTICE_CAP = 3;

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

/** The notices given, collapsed by direction, sorted nearest first, and capped (see the file header). */
export function selectMuffledNotices(
  notices: readonly { direction: string; band: string }[],
): MuffledNotice[] {
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
    .slice(0, MUFFLED_NOTICE_CAP)
    .map(([direction, band]) => ({
      direction: direction as MuffledNotice['direction'],
      band: (BAND_ORDER[band] ?? 'far') as MuffledNotice['band'],
    }));
}
