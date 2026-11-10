import { type ActionOutcome, cancelled, completed } from './outcome.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Longest `wait` in seconds; the contract allows no more. */
const MAX_WAIT_SECONDS = 600;

/**
 * Idles for `seconds` of world time (wall time scaled by `timeScale`), then completes. Ends early,
 * as cancelled, when its abort signal fires.
 */
export const waitAction: ActionHandler<'wait'> = {
  kind: 'wait',
  // The longest wait plus a little slack: the runner's timeout must not cut a legal wait short.
  timeoutMs: (MAX_WAIT_SECONDS + 5) * 1000,
  run: (ctx, action) => idle(ctx, action.seconds),
};

async function idle(ctx: ActionContext, seconds: number): Promise<ActionOutcome> {
  const wallMs = seconds * 1000 * ctx.timeScale;
  if (ctx.signal.aborted) return cancelled();
  const finished = await new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, wallMs);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
  });
  return finished ? completed({ waited_seconds: seconds }) : cancelled();
}
