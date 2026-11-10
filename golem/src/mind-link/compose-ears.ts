import type { Ears } from './senses.ts';

/**
 * One `Ears` from the two halves the Body builds: `heard()` comes from the chat ears (`BotEars`),
 * `peekEvents()` and `ackEvents()` from the digest of what happened (`RecentEvents`). The snapshot
 * builder reads both through the one interface.
 */
export function composeEars(
  chat: Pick<Ears, 'heard'>,
  events: Pick<Ears, 'peekEvents' | 'ackEvents'>,
): Ears {
  return {
    heard: () => chat.heard(),
    peekEvents: () => events.peekEvents(),
    ackEvents: (count) => events.ackEvents(count),
  };
}
