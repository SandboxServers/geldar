import type { McpPlayerEvent } from '@geldar/contract';
import type { SimEvent } from '../events.ts';

/** The sim event narrowed to one kind (SimEvent is one flat interface, so Extract cannot narrow it). */
export type SimEventOf<K extends string> = SimEvent & { kind: K };

/** The per-call state the presenters read: the overheard lines and the digest's place. */
export interface PresentCall {
  overheard: SimEvent[];
  lastOverheard: SimEvent | undefined;
}

/** The fields every player line carries. */
export interface PresentBase {
  seq: number;
  tick: number;
}

/** Turns one sim event kind into the player-facing lines it becomes. */
export interface PresentHandler {
  /** The sim event kind this handler presents. */
  readonly kind: SimEvent['kind'];
  present(event: SimEvent, base: PresentBase, call: PresentCall): McpPlayerEvent[];
}

/** Builds the presenter for one sim event kind; `present` is given that kind's event only. */
export function definePresentHandler<K extends SimEvent['kind']>(
  kind: K,
  present: (event: SimEventOf<K>, base: PresentBase, call: PresentCall) => McpPlayerEvent[],
): PresentHandler {
  return {
    kind,
    present: (event, base, call) => present(event as SimEventOf<K>, base, call),
  };
}
