import { markedWords, observationSentence } from '@geldar/contract';
import { defineMindHandler } from './types.ts';

/** A Minecraft player name (the golem's observed-actor pattern). */
const ACTOR_NAME = /^[A-Za-z0-9_]{3,16}$/;

/**
 * The name the player may see: a Minecraft name with no marker word in it, else undefined. A name that
 * fails either test is dropped and the event is kept without it.
 */
export function visibleActorName(value: unknown): string | undefined {
  return typeof value === 'string' && ACTOR_NAME.test(value) && markedWords(value).length === 0
    ? value
    : undefined;
}

/** The observation fields the player line reads; the contract has already checked the payload. */
interface ObservationFields {
  kind?: unknown;
  actor?: { name?: unknown };
  item?: unknown;
  count?: unknown;
  block?: unknown;
}

/**
 * An observation (AN-24) becomes one sim event: the fixed sentence from `observationSentence`, and the
 * visible actor's name when it passes `visibleActorName`. The life id and the key never reach the player.
 */
export const observationHandler = defineMindHandler('observation', (event, base) => {
  const p: ObservationFields = event.payload;
  const kind = p.kind === 'gift_received' || p.kind === 'property_broken' ? p.kind : undefined;
  const actor = visibleActorName(p.actor?.name);
  const item = typeof p.item === 'string' ? p.item : undefined;
  const count = typeof p.count === 'number' ? p.count : undefined;
  const block = typeof p.block === 'string' ? p.block : undefined;
  return [
    {
      ...base,
      kind: 'observation',
      text: observationSentence({ kind: p.kind, item: p.item, count: p.count, block: p.block }),
      ...(kind !== undefined ? { observationKind: kind } : {}),
      ...(actor !== undefined ? { actor } : {}),
      ...(item !== undefined ? { item } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(block !== undefined ? { block } : {}),
    },
  ];
});
