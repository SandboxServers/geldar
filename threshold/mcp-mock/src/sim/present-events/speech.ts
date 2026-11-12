import { definePresentHandler } from './types.ts';

/** Addressed speech is named; overheard speech collapses to one digest, placed at its last line. */
export const speechPresenter = definePresentHandler('speech', (e, base, call) => {
  if (e.addressed) return [{ ...base, type: 'speech_to_me', text: 'Someone spoke to you.' }];
  if (e === call.lastOverheard) {
    return [
      {
        ...base,
        type: 'conversation_digest',
        text: `${call.overheard.length} lines overheard.`,
      },
    ];
  }
  return [];
});
