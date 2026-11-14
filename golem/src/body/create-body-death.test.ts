import { describe, expect, it, vi } from 'vitest';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { createBody } from './create-body.ts';
import { planFor, thought } from './executor.fakes.ts';
import { IntentExecutor } from './executor.ts';

const LIFE = 'ag_test_01';

/** A body over fakes whose snapshot revision is 5 when the Body dies. */
function body(bot = fakeBot()) {
  return createBody({
    lifeId: LIFE,
    bodyGeneration: 3,
    bot,
    ticks: manualTicks().source,
    currentRevision: () => 5,
    view: fakeView(),
  });
}

describe('createBody: the death hook', () => {
  it('a plan made at the revision the Body died at is refused stale_snapshot', async () => {
    const bot = fakeBot();
    const made = body(bot);
    bot.emit('death');
    const result = await made.executor.submit(
      thought({ actions: [{ do: 'wait', seconds: 1 }] }),
      planFor(1, { n: 4, snapshotRevision: 5 }),
    );
    expect(result.rejection?.reason).toBe('stale_snapshot');
  });

  it('a death whose hook rejects is logged, and nothing is thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const endForDeath = vi
      .spyOn(IntentExecutor.prototype, 'endForDeath')
      .mockRejectedValueOnce(new Error('sink down'));
    const bot = fakeBot();
    body(bot);
    bot.emit('death');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sink down'));
    endForDeath.mockRestore();
    warn.mockRestore();
  });
});
