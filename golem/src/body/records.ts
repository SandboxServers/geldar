import type { ActionRecord, Receipt, Thought } from '@geldar/contract';
import type { ReflexOutcome } from './reflex.ts';
import type { WakeRequest } from './wake.ts';

/** Where an intent is. Built from spec 5.3 and section 7; the executor packet owns the transitions. */
export type IntentState =
  | 'accepted'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** One state change of an intent. `intentChanged` gets one per transition, never a repeat. */
export interface IntentChange {
  intentId: string;
  lifeId: string;
  bodyGeneration: number;
  state: IntentState;
  /** World age of the change. */
  tick: number;
  /** Why, in plain text (for example the failure message). */
  detail?: string;
  /**
   * The intent as accepted: set on the ccepted change, so the record can show what the intent
   * was (goal, program, arguments, preconditions, wake_on, limits). Absent on the other changes.
   */
  intent?: NonNullable<Thought['intent']>;
}

/**
 * A reflex firing: what the Body did on its own, so the Mind and the Historian see it
 * (wave 4 conventions). `trigger` is the values `check` returned.
 */
export interface ReflexFiredRecord {
  name: string;
  lifeId: string;
  bodyGeneration: number;
  tick: number;
  trigger: Record<string, string | number | boolean | null>;
  outcome: ReflexOutcome;
}

/**
 * Where the Body's records go. The runtime and everything built on it call these and nothing
 * else; the persistence packet supplies the real sink, `MemorySink` serves tests. Each method is
 * synchronous and must not throw: a sink that cannot store a record logs it and carries on.
 */
export interface RecordSink {
  /** An intent changed state. */
  intentChanged(change: IntentChange): void;
  /** An action record was created or changed state (the contract's `ActionRecord`). */
  actionChanged(record: ActionRecord): void;
  /** A receipt phase was written (prepared, committed or aborted). */
  receipt(receipt: Receipt): void;
  /** A reflex ran. */
  reflexFired(record: ReflexFiredRecord): void;
  /** The Body decided to wake the Mind. */
  wake(request: WakeRequest): void;
}

/** A sink that keeps every record in order, in arrays. For tests and for a Body with no store. */
export class MemorySink implements RecordSink {
  readonly intents: IntentChange[] = [];
  readonly actions: ActionRecord[] = [];
  readonly receipts: Receipt[] = [];
  readonly reflexes: ReflexFiredRecord[] = [];
  readonly wakes: WakeRequest[] = [];

  intentChanged(change: IntentChange): void {
    this.intents.push({ ...change });
  }

  actionChanged(record: ActionRecord): void {
    // A snapshot: the caller may keep mutating the record it passed.
    this.actions.push(structuredClone(record));
  }

  receipt(receipt: Receipt): void {
    this.receipts.push(structuredClone(receipt));
  }

  reflexFired(record: ReflexFiredRecord): void {
    this.reflexes.push(structuredClone(record));
  }

  wake(request: WakeRequest): void {
    this.wakes.push({ ...request });
  }
}
