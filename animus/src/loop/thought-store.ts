/**
 * The memory search that feeds a thought, and the `thoughts` row write that records one. Both are
 * best effort: a failed or hung await is bounded, reported and counted, never thrown into the cycle.
 */
import type { Snapshot, Thought } from '@geldar/contract';
import type { ModelCompletion, ModelMessage, WakeDecision } from '../ports/index.ts';
import { bounded, CycleAborted } from './cycle-await.ts';
import type { Cycle } from './cycle-state.ts';
import { buildThoughtRow } from './journal-row.ts';
import type { LoopEnv } from './loop-env.ts';
import { reportFailure, writeThoughtRow } from './thought-journal.ts';

/**
 * Embeds the wake and searches the episodic memories. Memory is best effort: each await has its own
 * bound, and a failure or a timeout gives none, so the cycle still thinks without them.
 */
export async function retrieveEpisodic(env: LoopEnv, decision: WakeDecision, snapshot: Snapshot) {
  const { deps, options } = env;
  const query = [
    decision.reason,
    snapshot.current_plan?.goal ?? '',
    ...snapshot.heard.map((h) => h.text),
  ]
    .join(' ')
    .slice(0, 512);
  try {
    const [vector] = await bounded(deps.embedder.embed([query], 'query'), env.stepMs, 'memory');
    if (vector === undefined) return [];
    return await bounded(
      deps.memory.searchEpisodic(options.lifeId, vector, options.episodicTopK),
      env.stepMs,
      'memory',
    );
  } catch {
    return [];
  }
}

/** Writes one `thoughts` row; a failed write is counted and reported, never thrown. */
export async function recordThought(
  env: LoopEnv,
  cycle: Cycle,
  thoughtId: string,
  wakeReason: string,
  messages: ModelMessage[] | null,
  completion: ModelCompletion | null,
  parsed: Thought | null,
  reserved: number,
  settled: number,
  errorCode?: string,
): Promise<void> {
  const { deps, options, report } = env;
  const row = buildThoughtRow({
    ...(errorCode === undefined ? {} : { errorCode }),
    thoughtId,
    snapshot: cycle.snapshot,
    wakeReason,
    messages,
    templateVersion: cycle.render.templateVersion,
    versions: options.versions,
    modelConfig: options.modelConfig,
    effort: cycle.effort.level,
    completion,
    parsed,
    creditsReserved: reserved,
    creditsSettled: settled,
    at: env.at(),
  });
  // The thought is valid and its credits are settled, so a write that fails or hangs is counted,
  // not fatal: the plan is still sent.
  try {
    const written = await bounded(
      writeThoughtRow(deps.journal, row, thoughtId, report),
      env.stepMs,
      'journal',
    );
    if (!written) cycle.journalErrors++;
  } catch (error) {
    if (!(error instanceof CycleAborted)) throw error;
    reportFailure(report, error, 'journal_write_failed', { thought_id: thoughtId });
    cycle.journalErrors++;
  }
}
