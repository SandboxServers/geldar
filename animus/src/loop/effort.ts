/**
 * Effort from observable signals (spec 5.3.3). The model is fixed for a life; what varies is how
 * much reasoning a thought may spend. Escalation never depends on the model saying it is unsure:
 * only failed intents, repeated failure wakes and the Body's stuck report raise it.
 */
import type { Snapshot } from '@geldar/contract';
import type { JobSettings } from '../config.ts';

/** The effort levels recorded on a thought. */
export type Effort = 'minimal' | 'high';

/** What the loop observed before this thought. */
export interface EffortSignals {
  /** Intents that failed one after another, with no completion or start between. */
  failedIntentsInARow: number;
  /** The wake before this one and this one are both `precondition_failed` or `action_failed`. */
  repeatedFailureWake: boolean;
  /** The snapshot's `stuck` report, null when the Body's watchdog sees nothing repeating. */
  stuck: Snapshot['stuck'];
}

/** The chosen level and the signals that raised it (empty for `minimal`). */
export interface EffortChoice {
  level: Effort;
  reasons: string[];
}

/** The model-call parameters an effort level gives. */
export interface JobShape {
  maxTokens: number;
  /** Seconds from dispatch to the deadline. */
  deadlineS: number;
  reasoning: 'off' | 'on';
}

/** The failed-intents count at which effort turns high. */
export const FAILED_INTENTS_FOR_HIGH = 2;
/** The longest a high-effort thought may be given, in seconds (the cap on the deadline). */
export const HIGH_DEADLINE_CAP_S = 60;
/** High effort allows this many times the configured output tokens. */
export const HIGH_TOKEN_FACTOR = 2;

const FAILURE_WAKES: ReadonlySet<string> = new Set(['precondition_failed', 'action_failed']);

/** True when `previous` and `current` are both failure wakes. */
export function isRepeatedFailureWake(previous: string | null, current: string): boolean {
  return previous !== null && FAILURE_WAKES.has(previous) && FAILURE_WAKES.has(current);
}

/** `high` when any signal fires, otherwise `minimal`. */
export function chooseEffort(signals: EffortSignals): EffortChoice {
  const reasons: string[] = [];
  if (signals.failedIntentsInARow >= FAILED_INTENTS_FOR_HIGH) reasons.push('failed_intents');
  if (signals.repeatedFailureWake) reasons.push('repeated_failure_wake');
  if (signals.stuck !== null && signals.stuck !== undefined) reasons.push('stuck');
  return { level: reasons.length > 0 ? 'high' : 'minimal', reasons };
}

/**
 * Minimal effort is the configured tokens and deadline with reasoning off. High effort turns
 * reasoning on, doubles the tokens and doubles the deadline up to `HIGH_DEADLINE_CAP_S`.
 */
export function jobShape(level: Effort, settings: JobSettings): JobShape {
  if (level === 'minimal') {
    return { maxTokens: settings.maxTokens, deadlineS: settings.deadlineS, reasoning: 'off' };
  }
  return {
    maxTokens: settings.maxTokens * HIGH_TOKEN_FACTOR,
    deadlineS: Math.min(settings.deadlineS * 2, Math.max(settings.deadlineS, HIGH_DEADLINE_CAP_S)),
    reasoning: 'on',
  };
}
