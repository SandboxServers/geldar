import type { McpPlayerEvent } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';

/** Identical reflex lines fold into the first line of their run: the run the next firing may join. */
export interface ReflexRun {
  entry: McpPlayerEvent;
  text: string;
  atMs: number;
  count: number;
}

/** The sim event narrowed to one kind (SimEvent is one flat interface, so Extract cannot narrow it). */
export type SimEventOf<K extends string> = SimEvent & { kind: K };

/** The per-call state the presenters share: the overheard lines, and the reflex run being folded. */
export interface PresentCall {
  /** The overheard speech lines of this call, in order. */
  overheard: SimEvent[];
  /** The last overheard line: the digest is placed there. */
  lastOverheard: SimEvent | undefined;
  /** The reflex run the next identical firing may fold into, or null. */
  lastReflex: ReflexRun | null;
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
