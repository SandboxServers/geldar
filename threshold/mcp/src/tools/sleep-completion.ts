import type { PlanResultPayload } from '@geldar/contract';
import type { JournalStore, SleepMarks } from '../ports.ts';

/** A sleep the Body accepted and has not reported on: what its mark and journal line need. */
export interface PendingSleep {
  /** The world day of the sleep. */
  day: number;
  /** The event cursor the sleep digested up to, read before submit: the mark it writes on completion. */
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

  /** Drops every pending sleep of a life: its death ends the sleeps it held (decision 0227). */
  clearLife(lifeId: string): void {
    this.lives.delete(lifeId);
  }
}

/**
 * Submits a plan whose sleep is already pending. A refused or failed submit drops the entry, so
 * nothing waits for an outcome that will never come. The entry must be added before this call: the
 * Body may answer during the submit.
 */
export async function submitPending<A extends { accepted: boolean }>(
  pending: PendingSleeps | undefined,
  lifeId: string,
  thoughtId: string,
  submit: () => Promise<A>,
): Promise<A> {
  let ack: A;
  try {
    ack = await submit();
  } catch (err) {
    pending?.delete(lifeId, thoughtId);
    throw err;
  }
  if (!ack.accepted) pending?.delete(lifeId, thoughtId);
  return ack;
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
 * writes nothing. The mark is written monotonically: it keeps the later of the stored and the pending
 * day and cursor, so a sleep that settles late never lowers the mark. The entry is removed only after
 * both writes. A store error keeps the entry, logs one payload-free line and rethrows, so the stream's
 * retry loop runs the message again; the settle is idempotent, so a retry writes the mark and journal
 * line once. The journal line is appended after the mark, and only the write that completes removes
 * the entry, so a settled sleep writes nothing again.
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
    const stored = await deps.marks.read(lifeId);
    await deps.marks.write(lifeId, {
      lastSleepDay: Math.max(stored.lastSleepDay, sleep.day),
      cursor: Math.max(stored.cursor, sleep.cursor),
    });
    if (sleep.journal !== null) await deps.journal.append(lifeId, sleep.journal, deps.now());
  } catch (err) {
    deps.log({ event: 'sleep_settle_error', kind: err instanceof Error ? err.name : 'unknown' });
    throw err;
  }
  deps.pending.delete(lifeId, result.thought_id);
}
