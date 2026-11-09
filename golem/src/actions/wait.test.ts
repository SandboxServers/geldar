import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { createRegistry } from './index.ts';
import { runAction } from './registry.ts';
import { waitAction } from './wait.ts';

const bot = {} as unknown as Bot;

describe('wait', () => {
  it('is registered', () => {
    expect(createRegistry().kinds()).toContain('wait');
  });

  it('completes after the seconds, scaled by timeScale', async () => {
    const started = Date.now();
    const run = await runAction(
      createRegistry(),
      bot,
      { do: 'wait', seconds: 1 },
      { timeScale: 0.1 },
    );
    const took = Date.now() - started;
    expect(run.state).toBe('completed');
    expect(run.result.detail).toMatchObject({ waited_seconds: 1 });
    expect(took).toBeGreaterThanOrEqual(80);
    expect(took).toBeLessThan(900);
  });

  it('is cancelled by its abort signal, long before the wait ends', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const started = Date.now();
    const run = await runAction(
      createRegistry(),
      bot,
      { do: 'wait', seconds: 600 },
      {
        signal: controller.signal,
      },
    );
    expect(run.state).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the handler itself ends as soon as its signal aborts', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const outcome = await waitAction.run(
      { bot, signal: controller.signal, timeScale: 1 },
      { do: 'wait', seconds: 600 },
    );
    expect(outcome.status).toBe('cancelled');
  });

  it('returns cancelled at once when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await waitAction.run(
      { bot, signal: controller.signal, timeScale: 1 },
      { do: 'wait', seconds: 600 },
    );
    expect(outcome.status).toBe('cancelled');
  });
});
