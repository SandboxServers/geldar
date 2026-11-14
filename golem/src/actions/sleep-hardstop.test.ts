import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { BED, bed, fakeBot, OTHER_HALF, sleep, walkUntilAborted } from './sleep.fakes.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

describe('sleep: the hard stop (decision 0190)', () => {
  // At timeScale 0.01 the 35 s hard stop is 350 ms of real time, so these tests run quickly.
  const SCALE = 0.01;
  const THREE_BEDS = [5, 9, 13].flatMap((x) => bed('white_bed', x));

  it('cuts a walk that never arrives and says the search time ran out, before the action timeout', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: THREE_BEDS });
    vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
    const outcome = await sleep(bot, SCALE);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringMatching(/^tried 1 of 3 nearby beds; the search time ran out; last: /),
    });
    expect(bot.sleep).not.toHaveBeenCalled();
    expect(moveNear).toHaveBeenCalledWith(
      bot,
      THREE_BEDS[0]?.position,
      1,
      expect.objectContaining({ stallTicks: 300, timeScale: SCALE }),
    );
    // The walk in flight was told to stop: its signal is aborted.
    expect(vi.mocked(moveNear).mock.calls[0]?.[3].signal.aborted).toBe(true);
  });

  it('cuts a walk at the 35 s hard stop, not before: 34.999 s is still running, 35 s is cut', async () => {
    vi.useFakeTimers();
    try {
      const bot = fakeBot({ timeOfDay: 13_000, blocks: THREE_BEDS });
      vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
      const outcome = sleep(bot, 1);
      await vi.advanceTimersByTimeAsync(34_999);
      expect(vi.mocked(moveNear).mock.calls[0]?.[3].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(vi.mocked(moveNear).mock.calls[0]?.[3].signal.aborted).toBe(true);
      expect(await outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message: expect.stringMatching(
          /^tried 1 of 3 nearby beds; the search time ran out; last: /,
        ),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('guards a bot.sleep that never settles: the hard stop cuts it (mineflayer times out at 3 s itself)', async () => {
    // Mineflayer's bot.sleep gives up after 3 s on its own, so this state is not the usual one. The walk
    // cut (stallTicks, the test above) is the fix for the stall; this test only proves the hard stop
    // would still end a sleep that hangs.
    const bot = fakeBot({ timeOfDay: 13_000, blocks: THREE_BEDS, hangSleep: true });
    const outcome = await sleep(bot, SCALE);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringMatching(/^tried 1 of 3 nearby beds; the search time ran out; last: /),
    });
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('bounds the out_of_reach retry: a second walk that never arrives is cut at the hard stop', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF }],
      sleepErrors: ['You are too far away'],
    });
    vi.mocked(moveNear)
      .mockImplementationOnce((async () => ({ ok: true, distance: 0 })) as never)
      .mockImplementationOnce(walkUntilAborted as never);
    const outcome = await sleep(bot, SCALE);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringMatching(/^tried 1 of 1 nearby beds; the search time ran out; last: /),
    });
    expect(moveNear).toHaveBeenNthCalledWith(2, bot, OTHER_HALF.position, 1, expect.anything());
    expect(vi.mocked(moveNear).mock.calls[1]?.[3].signal.aborted).toBe(true);
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('is cancelled, not blocked, when the external signal aborts during the walk', async () => {
    const controller = new AbortController();
    const bot = fakeBot({ timeOfDay: 13_000, blocks: THREE_BEDS });
    vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
    setTimeout(() => controller.abort(), 5);
    const outcome = await sleep(bot, 1, controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(bot.sleep).not.toHaveBeenCalled();
  });

  it('a fast sleep still completes well inside the hard stop', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }] });
    expect(await sleep(bot, SCALE)).toEqual({
      status: 'completed',
      detail: { bed: { x: 5, y: 64, z: 0 } },
    });
    expect(bot.isSleeping).toBe(true);
  });

  it('the out_of_reach retry passes the signal: an abort during the second bed attempt cancels it', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }, { ...OTHER_HALF }] });
    vi.mocked(bot.sleep)
      .mockRejectedValueOnce(new Error('You are too far away'))
      .mockImplementation(() => new Promise<void>(() => undefined));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const outcome = await sleep(bot, SCALE, controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(bot.sleep).toHaveBeenCalledTimes(2);
    expect(moveNear).toHaveBeenNthCalledWith(2, bot, OTHER_HALF.position, 1, expect.anything());
  });
});
