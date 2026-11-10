/**
 * The ports the thinking loop is built from, and what one cycle reports back.
 */
import type { PlanAck, PlanMessage } from '@geldar/contract';
import type {
  AttentionController,
  BodyLink,
  Embedder,
  EventPublisher,
  Journal,
  MemoryStore,
  ModelClient,
  OutputValidator,
  PromptLibrary,
  ThoughtOutcome,
} from '../ports/index.ts';
import type { Admission } from './admission.ts';
import type { EffortChoice } from './effort.ts';
import type { IntentLedger } from './fallback.ts';
/** The ports and state the loop is built from. */
export interface LoopDeps {
  body: BodyLink;
  model: ModelClient;
  memory: MemoryStore;
  journal: Journal;
  embedder: Embedder;
  prompts: PromptLibrary;
  validator: OutputValidator;
  attention: AttentionController;
  events: EventPublisher;
  /** Shared with the reflection, which spends 2 credits per run. */
  admission: Admission;
  /** Absent means a fresh ledger; pass one to share it with whoever feeds the Body's events. */
  ledger?: IntentLedger;
  /** Wall clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Waits `ms` or until `signal` aborts; tests pass an instant one. Defaults to a timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * Resolves true when a Thinker offering `model` is connected, false after `timeoutMs` (or an
   * abort). Absent means a `no_thinker` failure is final at once.
   */
  awaitThinker?: (model: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>;
  /** One structured log line: ids, codes and counts only, never prompt or completion text. */
  log?: (line: Record<string, unknown>) => void;
  /** Told of every failure the loop swallows (after it is logged). */
  onError?: (error: unknown) => void;
}

/** What one cycle did. */
export interface LoopResult {
  outcome: ThoughtOutcome;
  /** The id the cycle's plan or event carries; null when there was no snapshot. */
  thoughtId: string | null;
  plan: PlanMessage | null;
  /** The Body's answer to the plan, null when none was submitted. */
  ack: PlanAck | null;
  effort: EffortChoice | null;
  /** Model calls made (0 to 2). */
  modelCalls: number;
  /** Journal writes that failed; the cycle carries on. */
  journalErrors: number;
  /** Set when no snapshot could be had, so there was nothing to think about. */
  skipped?: 'snapshot_unavailable';
}
