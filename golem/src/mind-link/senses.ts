/**
 * What the Body lets the Mind sense and do with its voice (spec 5.2, 5.3.1). These interfaces are
 * the seam between the snapshot builder and the parts of the Body that know the world: the
 * perception module (authorized surroundings, recipes), the ears (chat and events) and the voice
 * (chat out). Later packets implement them against the live bot; `senses.fakes.ts` implements
 * them in memory for tests. No interface here may reach the Mind's own state.
 */
import type { Snapshot } from '@geldar/contract';

/** What the agent perceives of the world around it. Reads are synchronous and from cached state. */
export interface Perception {
  /**
   * The authorized surroundings (spec 5.2): only what the agent may know, never the bot's raw
   * view of the world. Returns the empty surroundings when nothing is known yet.
   */
  surroundings(): Snapshot['surroundings'];
  /**
   * Item names whose recipes the agent has unlocked (decision 0048), unique, at most 1500. An
   * empty list means none are unlocked, not that the Body does not know.
   */
  unlockedRecipes(): string[];
}

/** What the agent has heard and seen happen. */
export interface Ears {
  /**
   * Chat heard recently, oldest first, at most 50 lines (the snapshot cap). Does not consume
   * anything: calling it twice returns the same lines until they age out.
   */
  heard(): Snapshot['heard'];
  /**
   * Events since the last acknowledged snapshot, oldest first, at most 100. Does not consume them:
   * a snapshot that is not sent leaves them queued for the next one.
   */
  peekEvents(): Snapshot['events_since_last_thought'];
  /** Consumes the first `count` events, the ones a sent snapshot carried. */
  ackEvents(count: number): void;
}

/** Why the Voice did not speak. */
export type SayRefusal =
  /** The text was empty after trimming. */
  | 'empty'
  /** The text is longer than 256 characters (the speech cap). */
  | 'too_long'
  /** The text starts with `/`: a command, never sent as chat. */
  | 'command'
  /** The Body's speech rate limit is not met yet. */
  | 'rate_limited'
  /** The bot is not connected to the world. */
  | 'not_connected';

/** The result of `Voice.say`. Never an exception for a refusal: the Mind records it. */
export type SayOutcome =
  /** The text was sent to chat as given. */
  | { status: 'said'; text: string }
  /** The text was not sent. */
  | { status: 'refused'; reason: SayRefusal };

/** The agent's voice: chat out. */
export interface Voice {
  /**
   * Speaks `text` in chat. Resolves with a refusal (not a rejection) for expected problems;
   * rejects only for a failure of the connection itself.
   */
  say(text: string): Promise<SayOutcome>;
}
