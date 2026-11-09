/**
 * The `thoughts` row for one model call (spec 5.3.4 "write the thought to the journal", "Audit, not
 * replay"): the complete input, the raw output, the parsed thought and every version.
 */
import type { Snapshot, Thought } from '@geldar/contract';
import type { ModelCompletion, ModelMessage, ThoughtRow } from '../ports/index.ts';

/** The versions every thought records besides the prompt template's. */
export interface LoopVersions {
  schema: string;
  mind: string;
  body: string;
}

/** What `buildThoughtRow` needs. */
export interface ThoughtRowInput {
  thoughtId: string;
  /** The snapshot with the budget and sleep fields set. */
  snapshot: Snapshot;
  /** The wake reason, or `corrective_retry` for the second call. */
  wakeReason: string;
  /** The messages sent; null for a cycle that made no call (tired). */
  messages: ModelMessage[] | null;
  templateVersion: string;
  versions: LoopVersions;
  modelConfig: string;
  effort: string;
  /** The completion, null when the call failed or was never made. */
  completion: ModelCompletion | null;
  /** The validated thought, null when the output was rejected or there was none. */
  parsed: Thought | null;
  creditsReserved: number;
  creditsSettled: number;
  /** ISO 8601. */
  at: string;
  /** The code of the model failure when the call failed, kept in `provider_usage`. */
  errorCode?: string;
}

/** Characters to tokens, the estimate the journal records beside the provider's own count. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** The row for one call. Estimates are chars/4; the provider's usage is kept as reported. */
export function buildThoughtRow(input: ThoughtRowInput): ThoughtRow {
  const { completion, messages } = input;
  const inChars = messages?.reduce((sum, m) => sum + m.content.length, 0) ?? null;
  const usage = completion?.usageReported;
  return {
    thoughtId: input.thoughtId,
    lifeId: input.snapshot.agent_id,
    at: input.at,
    worldDay: input.snapshot.world_time.day,
    worldTick: input.snapshot.world_time.ticks,
    wakeReason: input.wakeReason,
    snapshot: input.snapshot,
    modelInput: messages,
    promptTemplateVersion: input.templateVersion,
    schemaVersion: input.versions.schema,
    mindVersion: input.versions.mind,
    bodyVersion: input.versions.body,
    modelConfig: input.modelConfig,
    thinkerId: completion?.thinkerId ?? null,
    effort: input.effort,
    tokensInEstimated: inChars === null ? null : estimateTokens(inChars),
    tokensOutEstimated: completion === null ? null : estimateTokens(completion.text.length),
    providerUsage:
      usage !== undefined
        ? {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            source: 'provider',
          }
        : input.errorCode !== undefined
          ? { error_code: input.errorCode, source: 'error' }
          : null,
    rawOutput: completion?.text ?? null,
    parsed: input.parsed,
    latencyMs: completion?.latencyMs ?? null,
    creditsReserved: input.creditsReserved,
    creditsSettled: input.creditsSettled,
  };
}
