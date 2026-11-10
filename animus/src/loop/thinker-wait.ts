/**
 * One model call, waiting for a Thinker when none is connected (spec 5.3.4). A `no_thinker`
 * failure waits up to `waitMs` for a Thinker to connect and retries once; the original error stands
 * when none comes.
 */
import { type ModelCompletion, ModelError } from '../ports/index.ts';

/** What the thinker wait reads from the loop. */
export interface ThinkerWait {
  model: string;
  lifeId: string;
  /** How long a `no_thinker` call waits, in milliseconds; 0 means not at all. */
  waitMs: number;
  awaitThinker?:
    | undefined
    | ((model: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>);
  signal: AbortSignal;
  log: (line: Record<string, unknown>) => void;
}

/** Runs `call`, and on `no_thinker` waits for a Thinker and calls once more. */
export async function callWaitingForThinker(
  call: () => Promise<ModelCompletion>,
  wait: ThinkerWait,
): Promise<ModelCompletion> {
  try {
    return await call();
  } catch (error) {
    const { awaitThinker, waitMs } = wait;
    if (
      !(error instanceof ModelError) ||
      error.code !== 'no_thinker' ||
      awaitThinker === undefined ||
      waitMs <= 0
    ) {
      throw error;
    }
    wait.log({ event: 'thinker_wait', life_id: wait.lifeId, wait_ms: waitMs });
    const connected = await awaitThinker(wait.model, waitMs, wait.signal);
    wait.log({ event: 'thinker_wait_over', life_id: wait.lifeId, connected });
    if (!connected) throw error;
    return await call();
  }
}
