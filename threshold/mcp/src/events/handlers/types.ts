import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';

/** What the mapper remembers about a life's running intent between events. */
export interface RunState {
  /** The running intent's `wake_on`, or null when none runs or it names none. */
  wakeOn: string[] | null;
  /** When the running intent was accepted, in epoch milliseconds, or null. */
  startedMs: number | null;
  /**
   * The id of the last intent this life saw end. The Body follows an intent's end with a wake for the
   * same intent; that wake is no second end. Undefined until an intent ends.
   */
  lastEndedId?: string | undefined;
}

/** The per-life state the mapper reads and writes. */
export interface MapContext {
  /** Who the agent is, for classifying the speech it hears. */
  identity: SpeechIdentity;
  /** The running intent per life, keyed by life id. */
  runs: Map<string, RunState>;
}

/** The fields every mapped event carries, read from the Mind event before a handler runs. */
export interface EventBase {
  seq: number;
  tick: number;
  atMs: number;
  wakeOn: string[] | null;
}

/** Maps one Mind event type to the player-facing events it becomes (none when the player does not see it). */
export interface MindHandler {
  /** The Mind event type this handler maps. */
  readonly type: MindEvent['type'];
  map(event: MindEvent, base: EventBase, ctx: MapContext): SimEvent[];
}

/** Builds the handler for one Mind event type; `map` is given that type's event only. */
export function defineMindHandler<T extends MindEvent['type']>(
  type: T,
  map: (event: Extract<MindEvent, { type: T }>, base: EventBase, ctx: MapContext) => SimEvent[],
): MindHandler {
  return {
    type,
    map: (event, base, ctx) => map(event as Extract<MindEvent, { type: T }>, base, ctx),
  };
}
