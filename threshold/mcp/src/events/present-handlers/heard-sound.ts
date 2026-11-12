import { definePresentHandler } from './types.ts';

/** A heard sound becomes one player line: its fixed sentence, already built by the mapper. */
export const heardSoundPresenter = definePresentHandler('heard_sound', (e, base) => [
  { ...base, type: 'heard_sound', text: e.text ?? '' },
]);
