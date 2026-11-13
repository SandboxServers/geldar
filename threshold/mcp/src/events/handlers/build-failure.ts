import { playerDetailText } from '@geldar/contract';

/**
 * The shape of the Body's build text: the progress sentence (`Built shelter: 9 placed, 12 already solid,
 * of 25.`) that opens a failed or completed build. Its counts are never read; the whole text is the Body's.
 */
const BUILD_TEXT = /^Built [a-z]+: \d{1,3} placed, \d{1,3} already solid, of \d{1,3}\./;

/**
 * The Body's own build text for a failed intent, as the player reads it: the progress sentence and what
 * came after it (`... could not be placed; first failure: ...`, `... Out of dirt: 11 more needed.`).
 * `playerDetailText` drops a text with coordinates, marker words or unsafe characters, and cuts it to 160
 * characters. Undefined when the detail is not a build text of the current shape (an older format, or any
 * other detail), so the caller falls back to the bare failure.
 */
export function buildFailureReason(detail: string): string | undefined {
  if (!BUILD_TEXT.test(detail)) return undefined;
  return playerDetailText(detail);
}
