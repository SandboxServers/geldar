import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTargets, showLoadFailure } from '../../web/kino/startup.ts';
import type { TargetsOutcome } from '../../web/kino/targets.ts';
import { type PreviewOptions, RETRY_AFTER_SECONDS, startPreview } from './server.ts';

const WEB = join(import.meta.dirname, '../../web/kino');
const realFetch = globalThis.fetch;
const servers: { close(): void }[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function serve(opts: PreviewOptions): Promise<string> {
  const server = startPreview(0, WEB, opts);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Runs the page's own loadTargets against the preview, then the page's failure screen when it fails. */
async function pageAgainst(opts: PreviewOptions) {
  const base = await serve(opts);
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    realFetch(new URL(input, base), init),
  );
  const outcome: TargetsOutcome = await loadTargets();
  vi.unstubAllGlobals();
  const win = new Window({ url: 'https://glass.example.test/kino/' });
  const notice = win.document.createElement('div') as unknown as HTMLElement;
  if (!outcome.ok) {
    vi.stubGlobal('document', win.document);
    vi.useFakeTimers();
    showLoadFailure(notice, outcome.message, outcome.retryAfterSeconds, () => undefined);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
  return { outcome, notice, button: notice.querySelector('button') as HTMLButtonElement };
}

describe('kino preview failure screens', () => {
  it('serves the camera list when no refusal is set', async () => {
    const { outcome } = await pageAgainst({});
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.targets.agents.length).toBeGreaterThan(0);
  });

  it('refuse: the page shows the refusal with an enabled Retry', async () => {
    const { outcome, notice, button } = await pageAgainst({ refuse: true });
    expect(outcome).toEqual({
      ok: false,
      message: 'Could not load the camera list (HTTP 403). Retry',
      retryAfterSeconds: null,
    });
    expect(notice.textContent).toContain('HTTP 403');
    expect(button.textContent).toBe('Retry');
    expect(button.disabled).toBe(false);
  });

  it('targets429: the page shows a Retry countdown for Retry-After seconds', async () => {
    const { outcome, notice, button } = await pageAgainst({ targets429: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.retryAfterSeconds).toBe(RETRY_AFTER_SECONDS);
    expect(notice.textContent).toContain('HTTP 429');
    expect(button.textContent).toBe(`Retry (${RETRY_AFTER_SECONDS}s)`);
    expect(button.disabled).toBe(true);
  });
});
