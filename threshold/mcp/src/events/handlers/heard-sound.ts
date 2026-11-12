import { heardSoundSentence } from '@geldar/contract';
import { defineMindHandler } from './types.ts';

/**
 * A sound the Body heard (PX-4, decision 0154 ruling 3). The player reads one fixed sentence built from the
 * sound kind, the distance band and the compass point. The payload's position never reaches the player,
 * and a sound does not wake the agent (no wake interest maps to it).
 */
export const heardSoundHandler = defineMindHandler('heard_sound', (event, base) => {
  const p = event.payload as { sound?: unknown; dir?: unknown; band?: unknown };
  return [
    {
      ...base,
      kind: 'heard_sound',
      text: heardSoundSentence({ sound: p.sound, dir: p.dir, band: p.band }),
    },
  ];
});
