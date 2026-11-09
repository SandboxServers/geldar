/** A signal that aborts when its parent does or after a wall-clock limit; `clear` frees the timer. */
export interface Deadline {
  signal: AbortSignal;
  /** True when the limit, not the parent, ended it. */
  timedOut(): boolean;
  clear(): void;
}

/** Wraps `parent` with a wall-clock limit in milliseconds. Always call `clear` when the work ends. */
export function deadline(parent: AbortSignal, ms: number): Deadline {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const forward = (): void => controller.abort();
  if (parent.aborted) forward();
  parent.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', forward);
    },
  };
}
