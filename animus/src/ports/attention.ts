/**
 * The attention controller (spec 5.3.2, 5.3.4): it reads every event of the life and decides when
 * the Mind should think and when to stay quiet. P0-27 implements it; the thinking loop (P0-30) and
 * the reflection (P0-31) are its callers. All time here is world ticks or the injected clock; the
 * controller never reads the wall clock itself.
 */
import type { ThoughtEventPayload } from '@geldar/contract';
import type { MindEvent } from './body.ts';

/** The reasons the Body gives in a `wake` event (wake-event.schema.json). */
export type BodyWakeReason =
  | 'directly_addressed'
  | 'precondition_failed'
  | 'unexpected_damage'
  | 'goal_completed'
  | 'reflex_danger'
  | 'action_failed'
  | 'limit_reached'
  | 'no_plan'
  /** A new agent came within N blocks. */
  | `new_agent_within_${number}`;

/** Why the Mind wakes: the Body's reasons plus the ones the Mind decides itself. */
export type MindWakeReason =
  | BodyWakeReason
  /** Someone spoke to the agent by name. */
  | 'speech_addressed'
  /** Someone spoke about the agent without addressing it. */
  | 'speech_about_me'
  /** Someone spoke about a commitment the agent holds with the speaker. */
  | 'speech_about_my_commitments'
  /** Nothing has happened for a while and no plan is running. */
  | 'idle'
  /** The fallback timer fired (`attention.fallback_wakeup_ticks`). */
  | 'fallback'
  /** The Mind has just started and has not thought yet. */
  | 'mind_start';

/** One speaker's part of the conversation digest. */
export interface DigestEntry {
  speaker: string;
  /** How many lines the speaker said since the digest was last taken. */
  count: number;
  /** The last three lines, oldest first. */
  lastLines: string[];
}

/** A decision to think. */
export interface WakeDecision {
  /** The reason recorded on the thought. */
  reason: MindWakeReason;
  /** The events that led to the wake, oldest first. */
  events: MindEvent[];
  /**
   * Events folded in without waking (overheard chat, `attention.overheard_to_digest`), oldest
   * first, for the prompt's digest section.
   */
  digest: MindEvent[];
  /** The same chatter as per-speaker counts and last lines (absent on a hand-made decision). */
  digestSummary?: DigestEntry[];
  /** Higher is more urgent: 0 idle or fallback, 1 normal, 2 danger or direct address. */
  priority: 0 | 1 | 2;
}

/** Why the controller did not wake the Mind for an event. Stored in `suppressed_wakeups.reason`. */
export type SuppressionReason =
  /** The minimum spacing since the last wake has not passed. */
  | 'min_spacing'
  /** A thought is already running: the wake was held and merged behind it. */
  | 'coalesced_in_flight'
  /** The event was folded into the digest. */
  | 'digested'
  /** The same wake is already pending. */
  | 'duplicate'
  /** A running intent does not need the Mind yet. */
  | 'intent_running'
  /** The thought budget is spent. */
  | 'tired'
  /** The Body gave no snapshot within the retry window, so there was nothing to think about. */
  | 'snapshot_unavailable';

/** A reflection is due: the agent slept, so the day is to be summarised (spec 5.4). */
export interface ReflectionDue {
  lifeId: string;
  /** The world day that ended. */
  day: number;
  /** The `sleep` event that triggered it. */
  event: MindEvent;
}

/** How a thought ended, as recorded in the `thought` event. */
export type ThoughtOutcome = ThoughtEventPayload['outcome'];

/**
 * The controller of one life. It records every suppression itself through the `Journal` it is
 * constructed with (`recordSuppressed`); the loop does not.
 */
export interface AttentionController {
  /** Feeds one event. Never throws; wakes and suppressions come out through the callbacks. */
  onEvent(event: MindEvent): void;
  /** Registers a callback for wake decisions. Returns the unregister function. */
  onDecision(callback: (decision: WakeDecision) => void): () => void;
  /** Registers a callback for a due reflection. Returns the unregister function. */
  onReflectionDue(callback: (due: ReflectionDue) => void): () => void;
  /** The loop calls this when it starts thinking on a decision, so overlapping wakes are held. */
  thoughtStarted(): void;
  /** The loop calls this when the thought ends, whatever the outcome. */
  thoughtSettled(outcome: ThoughtOutcome): void;
}
