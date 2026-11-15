import type { JournalStore, SleepMarks } from './ports.ts';
import { PendingSleeps, type SleepCompletionDeps } from './tools/sleep-completion.ts';

/** What the sleep wiring takes from the process: the marks, the journal, the clock and the log. */
export interface SleepWiringInput {
  marks: SleepMarks;
  journal: JournalStore;
  now: () => number;
  log: SleepCompletionDeps['log'];
}

/** The pending sleeps of one process, and the two places that use them. */
export interface SleepWiring {
  pending: PendingSleeps;
  /** The part of the world's dependencies the sleep needs. */
  worldDeps: { pendingSleeps: PendingSleeps };
  /** The stream's sleep context: it settles a pending sleep on plan_result. */
  stream: SleepCompletionDeps;
}

/**
 * Builds the one `PendingSleeps` of a process and hands it to both the world, which registers a sleep
 * the Body accepts, and the stream, which settles it on plan_result. Both come from here so they
 * cannot drift onto separate instances: a sleep registered in one and settled from the other never
 * completes (decision 0227).
 */
export function createSleepWiring(input: SleepWiringInput): SleepWiring {
  const pending = new PendingSleeps();
  return {
    pending,
    worldDeps: { pendingSleeps: pending },
    stream: {
      pending,
      marks: input.marks,
      journal: input.journal,
      now: input.now,
      log: input.log,
    },
  };
}
