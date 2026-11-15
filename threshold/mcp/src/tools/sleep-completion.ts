import type { PlanResultPayload } from '@geldar/contract';
import type { JournalStore, SleepMarks } from '../ports.ts';

/** A sleep the Body accepted and has not reported on: what its mark and journal line need. */
export interface PendingSleep {
  /** The world day of the sleep. */
  day: number;
  /** The event cursor the sleep digested up to, read at submit: the mark it writes on completion. */
  cursor: number;
  /** The index of the sleep action in the plan's actions. */
  action: number;
  /** The "asleep" journal line, or null when the sleep is quiet and journals nothing. */
  journal: string | null;
}

/** The most sleeps one life may hold awaiting an outcome; the oldest is evicted past it. */
export const PENDING_SLEEP_LIMIT = 16;

/**
 * The sleeps accepted and not yet completed, by life and thought. In memory only: a restart drops
 * them, and an outcome that arrives after a restart writes nothing (a known limit, decision 0227).
 */
export class PendingSleeps {
  private readonly lives = new Map<string, Map<string, PendingSleep>>();

  add(lifeId: string, thoughtId: string, sleep: PendingSleep): void {
    const thoughts = this.lives.get(lifeId) ?? new Map<string, PendingSleep>();
    if (!thoughts.has(thoughtId) && thoughts.size >= PENDING_SLEEP_LIMIT) {
      // A Map iterates in insertion order, so the first key is the oldest sleep.
      const oldest = thoughts.keys().next();
      if (oldest.done !== true) thoughts.delete(oldest.value);
    }
    thoughts.set(thoughtId, sleep);
    this.lives.set(lifeId, thoughts);
  }

  get(lifeId: string, thoughtId: string): PendingSleep | undefined {
    return this.lives.get(lifeId)?.get(thoughtId);
  }

  delete(lifeId: string, thoughtId: string): void {
    const thoughts = this.lives.get(lifeId);
    if (thoughts === undefined) return;
    thoughts.delete(thoughtId);
    if (thoughts.size === 0) this.lives.delete(lifeId);
  }
}

/** What settling a sleep writes, and the clock of its journal line. */
export interface SleepCompletionDeps {
  pending: PendingSleeps;
  marks: SleepMarks;
  journal: JournalStore;
  now: () => number;
  /** Receives one payload-free line when a settle write fails. */
  log: (line: Record<string, unknown>) => void;
}

/**
 * Settles a sleep on the Body's `plan_result`. Only a `completed` sleep action, not cut short by an
 * earlier failure, sets the mark and appends the journal line. A failed, cancelled or unknown one
 * writes nothing. The entry is removed only once its writes are done: a store error keeps it, logs
 * one line and does not throw, so a redelivered outcome may settle it again. The mark is written
 * first and is idempotent; the journal line is the last write, so a retry never doubles it.
 */
export async function completeSleep(
  deps: SleepCompletionDeps,
  lifeId: string,
  result: PlanResultPayload,
): Promise<void> {
  const sleep = deps.pending.get(lifeId, result.thought_id);
  if (sleep === undefined) return;
  const state = result.actions[sleep.action]?.state;
  // Not final yet: the entry waits for the outcome.
  if (state === 'accepted' || state === 'running') return;
  const cutShort = result.failed_at !== null && result.failed_at <= sleep.action;
  if (state !== 'completed' || cutShort) {
    deps.pending.delete(lifeId, result.thought_id);
    return;
  }
  try {
    await deps.marks.write(lifeId, { lastSleepDay: sleep.day, cursor: sleep.cursor });
    if (sleep.journal !== null) await deps.journal.append(lifeId, sleep.journal, deps.now());
  } catch (err) {
    deps.log({ event: 'sleep_settle_error', kind: err instanceof Error ? err.name : 'unknown' });
    return;
  }
  deps.pending.delete(lifeId, result.thought_id);
}
