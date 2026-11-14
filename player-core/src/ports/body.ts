/**
 * The Mind's view of its Body (spec 5.3.2, section 7). The Mind never touches the world: it asks
 * the Body for a snapshot, hands it a plan and reads the events the Body and the plugin publish.
 * P0-26 implements these over NATS, the fakes implement them in memory.
 */
import type {
  ActionOutcomePayload,
  ActionRecord,
  HeardSoundPayload,
  IntentEventPayload,
  PlanAck,
  PlanMessage,
  PlanResultPayload,
  ReflexFiredPayload,
  Snapshot,
  SpeechPayload,
  WakePayload,
  WorldEvent,
} from '@geldar/contract';

/** Why a Body call failed to get an answer. A refused plan is a `PlanAck`, not an error. */
export type BodyLinkErrorCode =
  /** No answer within the link's reply window. */
  | 'timeout'
  /** The Body is not reachable (no NATS connection, no responder). */
  | 'unavailable'
  /** The Body answered with something the contract rejects. */
  | 'invalid_reply';

/** The only error a `BodyLink` call rejects with. */
export class BodyLinkError extends Error {
  readonly code: BodyLinkErrorCode;

  constructor(code: BodyLinkErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BodyLinkError';
    this.code = code;
  }
}

/** The request and reply side of the channel to one life's Body. One instance per life. */
export interface BodyLink {
  /**
   * Asks the Body for a fresh snapshot. `reason` is at most 64 characters (the wake reason or a
   * short label). Resolves with a snapshot the contract has validated; rejects with `BodyLinkError`.
   */
  requestSnapshot(reason: string): Promise<Snapshot>;
  /**
   * Sends a plan and resolves with the Body's quick reply. A refusal (`accepted: false`) resolves;
   * the plan's later outcome arrives as a `plan_result` event. Rejects with `BodyLinkError`.
   */
  submitPlan(plan: PlanMessage): Promise<PlanAck>;
}

/** Fields every normalised event carries, copied from the `WorldEvent` envelope. */
export interface MindEventBase {
  /** The envelope's `source_event_id`; equal ids are the same event. */
  eventId: string;
  /** The life the event concerns. */
  lifeId: string;
  /** World age in ticks when it happened. */
  tick: number;
  /** World day when it happened. */
  day: number;
  /** Wall-clock time, ISO 8601. */
  at: string;
}

/** The fields of a plugin `damage`, `death` or `sleep` event the Mind reads. Free-form on the wire. */
export type PluginEventPayload = Record<string, unknown>;

/**
 * An event as the Mind reads it: the `WorldEvent` envelope flattened and the payload typed. Types
 * the Mind does not act on (trade, server_tps and so on) never become a `MindEvent`.
 */
export type MindEvent = MindEventBase &
  (
    | { type: 'wake'; payload: WakePayload }
    | { type: 'intent'; payload: IntentEventPayload }
    | { type: 'action'; payload: ActionRecord }
    | { type: 'plan_result'; payload: PlanResultPayload }
    | { type: 'action_outcome'; payload: ActionOutcomePayload }
    | { type: 'reflex_fired'; payload: ReflexFiredPayload }
    | { type: 'heard_sound'; payload: HeardSoundPayload }
    | { type: 'speech'; payload: SpeechPayload }
    | { type: 'damage'; payload: PluginEventPayload }
    | { type: 'death'; payload: PluginEventPayload }
    | { type: 'sleep'; payload: PluginEventPayload }
  );

/** The name of a `MindEvent` variant. */
export type MindEventType = MindEvent['type'];

/** Reads the events of one life as `MindEvent`s. */
export interface EventSource {
  /**
   * Calls `handler` for each event of `lifeId` in arrival order, each at most once. Events that
   * fail the contract or are of a type the Mind ignores are dropped by the source. The handler
   * must not throw; the source logs and carries on if it does. Returns the unsubscribe function,
   * which is safe to call twice.
   */
  subscribe(lifeId: string, handler: (event: MindEvent) => void): () => void;
}

/** Publishes the Mind's own events (`thought`, `reflection`, `speech` it decides on). */
export interface EventPublisher {
  /** Publishes one event on its type's subject. Resolves once the broker has stored it. */
  publish(event: WorldEvent): Promise<void>;
}
