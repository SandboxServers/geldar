import { heardMuffledSentence } from '@geldar/contract';
import { PLAY_MUFFLED_LIMIT, type PlaySnapshot, type SnapshotProjector } from './types.ts';

/**
 * The muffled voices of decision 0199 as the player's sentences, nearest first, at most PLAY_MUFFLED_LIMIT.
 * A notice whose direction or band heardMuffledSentence does not know is skipped, never guessed at, and does
 * not count towards the limit. The key is left out when no sentence is built, so a view with no muffled
 * notices is the same as one from before the notices existed. The text is fixed words, not untrusted text.
 */
export const muffledProjector: SnapshotProjector = (snapshot) => {
  const sentences: string[] = [];
  // The Body reply is validated before this runs, so a non-array is not expected; the guard is defence in depth.
  const list = Array.isArray(snapshot.heard_muffled) ? snapshot.heard_muffled : [];
  for (const notice of list) {
    if (sentences.length === PLAY_MUFFLED_LIMIT) break;
    try {
      sentences.push(heardMuffledSentence(notice.direction, notice.band));
    } catch {
      // An unknown code (or a malformed notice) is skipped: the player hears nothing of it.
    }
  }
  // The list is at most three long, the contract's maxItems; the assertion is the tuple the type names.
  return sentences.length === 0
    ? {}
    : { muffled: sentences as NonNullable<PlaySnapshot['muffled']> };
};
