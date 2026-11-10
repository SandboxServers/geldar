/**
 * Links an intent to the thought that planned it (spec Appendix D, `intents.thought_id`). The Mind
 * knows both ids once the Body accepts the plan, but the event sink writes the `intents` row a
 * moment later, so the link is retried with a short backoff for up to `INTENT_LINK_BUDGET_MS`. The
 * retries run in the background: the loop does not wait for them, and `stop` ends them.
 */
import type { Journal } from '../ports/index.ts';

/** How long a link keeps trying after the plan is accepted. */
export const INTENT_LINK_BUDGET_MS = 10_000;
/** The first wait between tries; it doubles up to the cap. */
const FIRST_WAIT_MS = 250;
const CAP_WAIT_MS = 2_000;

/** What an `IntentLinker` needs. */
export interface IntentLinkerOptions {
  journal: Journal;
  lifeId: string;
  /** Waits `ms` or until `signal` aborts, without rejecting. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** One structured log line per outcome: ids and counts only. */
  log?: (line: Record<string, unknown>) => void;
  /** How long the retries may run in total; defaults to `INTENT_LINK_BUDGET_MS`. */
  budgetMs?: number;
}

/** Starts intent links in the background and remembers them until they end. */
export class IntentLinker {
  private readonly options: IntentLinkerOptions;
  private readonly pending = new Set<Promise<void>>();

  constructor(options: IntentLinkerOptions) {
    this.options = options;
  }

  /** Starts linking `intentId` to `thoughtId` and returns at once. The task never rejects. */
  link(intentId: string, thoughtId: string, signal: AbortSignal): void {
    const task: Promise<void> = this.run(intentId, thoughtId, signal).finally(() => {
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  /** Resolves once every link started so far has ended (linked, given up or aborted). */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private async run(intentId: string, thoughtId: string, signal: AbortSignal): Promise<void> {
    const budget = this.options.budgetMs ?? INTENT_LINK_BUDGET_MS;
    let waited = 0;
    let wait = FIRST_WAIT_MS;
    let attempts = 0;
    let errors = 0;
    for (;;) {
      attempts++;
      try {
        if (await this.options.journal.linkIntent(this.options.lifeId, intentId, thoughtId)) {
          this.log('intent_linked', intentId, thoughtId, attempts, errors);
          return;
        }
      } catch {
        // A failed write is retried like a missing row; the count says how often it happened.
        errors++;
      }
      if (signal.aborted || waited >= budget) break;
      const step = Math.min(wait, budget - waited);
      await this.options.sleep(step, signal);
      waited += step;
      wait = Math.min(wait * 2, CAP_WAIT_MS);
    }
    this.log('intent_link_gave_up', intentId, thoughtId, attempts, errors);
  }

  private log(
    event: 'intent_linked' | 'intent_link_gave_up',
    intentId: string,
    thoughtId: string,
    attempts: number,
    errors: number,
  ): void {
    this.options.log?.({
      event,
      life_id: this.options.lifeId,
      intent_id: intentId,
      thought_id: thoughtId,
      attempts,
      journal_errors: errors,
    });
  }
}
