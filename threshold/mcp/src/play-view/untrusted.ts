import type { Snapshot, UntrustedWorldText } from '@geldar/contract';
import { PLAY_SIGN_LIMIT, PLAY_SPEECH_LIMIT, type Signs } from './types.ts';

/** The text other agents and players wrote: heard lines (newest first) and sign texts. */
export function untrustedText(snapshot: Snapshot): UntrustedWorldText {
  const speech = [...snapshot.heard]
    .sort((a, b) => a.age_seconds - b.age_seconds)
    .slice(0, PLAY_SPEECH_LIMIT)
    .map((line) => ({ from: line.from, text: line.text }));
  const signs: string[] = [];
  for (const block of snapshot.surroundings.notable_blocks) {
    if (block.text !== undefined) signs.push(block.text);
  }
  return {
    speech,
    // The generated type is a tuple for maxItems 20; the length is enforced by the slice.
    signs: signs.slice(0, PLAY_SIGN_LIMIT) as Signs,
  };
}
