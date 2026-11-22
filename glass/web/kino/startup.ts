import { type TargetsOutcome, targetsFetchFailed, targetsOutcome } from './targets.ts';

export async function loadTargets(): Promise<TargetsOutcome> {
  try {
    const r = await fetch('/kino/targets', { credentials: 'same-origin' });
    const body: unknown = await r.json().catch(() => null);
    return targetsOutcome(r.status, r.headers.get('Retry-After'), body);
  } catch {
    return targetsFetchFailed();
  }
}

/** A visible failure message with a Retry button; the button waits out Retry-After. */
export function showLoadFailure(
  notice: HTMLElement,
  message: string,
  wait: number | null,
  load: () => void,
): void {
  const text = document.createElement('span');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  let left = wait ?? 0;
  const tick = (): void => {
    retry.disabled = left > 0;
    retry.textContent = left > 0 ? `Retry (${left}s)` : 'Retry';
    if (left > 0) {
      left -= 1;
      setTimeout(tick, 1000);
    }
  };
  tick();
  retry.addEventListener('click', load);
  notice.replaceChildren(text, ' ', retry);
}
