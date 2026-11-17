/**
 * The probe's steps: the bounded waits, the goto and mine actions it sends, and the one-line
 * receipts it prints. The actions are the bench's action vocabulary (`goto`, `mine`); the probe
 * builds them here and runs them through the registry the Body uses.
 */
import type { Bot } from 'mineflayer';
import type { ActionRun } from '../actions/registry.ts';

/** The block the probe mines once. The scratch world has to offer one within reach. */
export const MINE_BLOCK = 'stone';
/** How many blocks east of the Body's spawn the goto walks. */
export const GOTO_BLOCKS = 3;

/** A position on the block grid. */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/** The goto target: `GOTO_BLOCKS` east of the Body's block, on the same level. */
export function gotoTarget(bot: Bot): Position {
  const at = bot.entity.position;
  return { x: Math.floor(at.x) + GOTO_BLOCKS, y: Math.floor(at.y), z: Math.floor(at.z) };
}

/** The goto action the probe runs. */
export function gotoAction(bot: Bot): { do: 'goto'; target: Position } {
  return { do: 'goto', target: gotoTarget(bot) };
}

/** The mine action the probe runs: one block of MINE_BLOCK. */
export function mineAction(): { do: 'mine'; block: string; count: number } {
  return { do: 'mine', block: MINE_BLOCK, count: 1 };
}

/** The plain receipt of a finished action: its state, its status, its reason and its latency. */
export function receiptOf(run: ActionRun): string {
  const { state, result } = run;
  const reason = result.reason ? ` reason=${result.reason}` : '';
  return `${state} status=${result.status}${reason} latency_ms=${result.latency_ms}`;
}

/** The reason text of a thrown value, for a printed failure. Never a credential: callers pass only their own errors. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Waits for `work` for at most `ms`, and gives up at once when `signal` aborts. The timer and the
 * abort listener are released on every outcome, so a finished step leaves no timer behind.
 */
export function bounded<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      const why = signal.reason instanceof Error ? signal.reason.message : 'interrupted';
      done(() => reject(new Error(`interrupted: ${why}`)));
    };
    const done = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    timer = setTimeout(() => done(() => reject(new Error(message))), ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    work.then(
      (value) => done(() => resolve(value)),
      (error: unknown) => done(() => reject(error)),
    );
  });
}
