import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { classifySleepError, isNightOrStorm, sleepAction } from './sleep.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

interface FakeBlock {
  name: string;
  position: Vec3;
}

interface FakeOptions {
  timeOfDay?: number;
  thundering?: boolean;
  /** The blocks in the world; `findBlocks` searches them in order. */
  blocks?: FakeBlock[];
  /** Messages `bot.sleep` rejects with, one per call, before it succeeds. */
  sleepErrors?: string[];
  /** True when the bot starts out in a bed. */
  asleep?: boolean;
}

/** A fake bot with a clock, a set of blocks, and a `sleep` that can reject. */
function fakeBot(options: FakeOptions = {}): Bot {
  const blocks = options.blocks ?? [];
  const errors = [...(options.sleepErrors ?? [])];
  let sleeping = options.asleep ?? false;
  const bot = {
    time: { timeOfDay: options.timeOfDay ?? 1_000 },
    thunderState: options.thundering ? 1 : 0,
    entity: { position: new Vec3(0, 64, 0) },
    get isSleeping() {
      return sleeping;
    },
    findBlocks: ({
      matching,
      count,
    }: {
      matching: (block: FakeBlock) => boolean;
      maxDistance: number;
      count: number;
    }) =>
      blocks
        .filter(matching)
        .slice(0, count)
        .map((block) => block.position),
    blockAt: (position: Vec3) => blocks.find((block) => block.position.equals(position)) ?? null,
    sleep: vi.fn(async (_bed: FakeBlock) => {
      const error = errors.shift();
      // The server says "already sleeping" only when the bot is in a bed.
      if (error && /already sleeping/i.test(error)) sleeping = true;
      if (error) throw new Error(error);
      sleeping = true;
    }),
  };
  return bot as unknown as Bot;
}

/** Runs the `sleep` handler with a fresh abort signal. */
function sleep(bot: Bot) {
  return sleepAction.run(
    { bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'sleep' },
  );
}

const BED = { name: 'white_bed', position: new Vec3(5, 64, 0) };
const OTHER_HALF = { name: 'white_bed', position: new Vec3(6, 64, 0) };

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

describe('isNightOrStorm', () => {
  it('is true from the start to the end of the night window', () => {
    expect(isNightOrStorm(12_541, false)).toBe(false);
    expect(isNightOrStorm(12_542, false)).toBe(true);
    expect(isNightOrStorm(23_459, false)).toBe(true);
    expect(isNightOrStorm(23_460, false)).toBe(false);
  });

  it('is true in a thunderstorm by day', () => {
    expect(isNightOrStorm(1_000, true)).toBe(true);
  });
});

describe('classifySleepError', () => {
  it('maps each Mineflayer error text to its reason', () => {
    expect(classifySleepError('There are monsters nearby')).toBe('not_possible');
    expect(classifySleepError('You are too far away')).toBe('out_of_reach');
    expect(classifySleepError('Bed is occupied')).toBe('blocked');
    expect(classifySleepError('Not a bed')).toBe('not_found');
    expect(classifySleepError('only half bed')).toBe('not_found');
    expect(classifySleepError('not sleeping')).toBe('blocked');
    expect(classifySleepError('cant click that')).toBe('blocked');
    expect(classifySleepError('not night')).toBe('not_possible');
    expect(classifySleepError('You are already sleeping')).toBe('not_possible');
    expect(classifySleepError('something else')).toBe('internal');
  });
});

describe('sleep', () => {
  it('fails with not_found when there is no bed', async () => {
    const outcome = await sleep(fakeBot({ timeOfDay: 13_000, blocks: [] }));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found', message: 'no bed' });
  });

  it('by day fails with not_possible and never calls bot.sleep', async () => {
    const bot = fakeBot({ timeOfDay: 1_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(bot.sleep).not.toHaveBeenCalled();
  });

  it('at night walks to the bed and completes asleep', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 5, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenCalledWith(
      bot,
      BED.position,
      1,
      expect.objectContaining({ timeScale: 1 }),
    );
    expect(bot.isSleeping).toBe(true);
  });

  it('retries on the other half of the bed after out_of_reach', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF }],
      sleepErrors: ['You are too far away'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 6, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenNthCalledWith(2, bot, OTHER_HALF.position, 1, expect.anything());
    expect(bot.sleep).toHaveBeenCalledTimes(2);
  });

  it('is completed without a bed call when the bot is already asleep', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }], asleep: true });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(bot.sleep).not.toHaveBeenCalled();
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('treats an already-sleeping rejection as asleep, not a failure', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }],
      sleepErrors: ['You are already sleeping'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('sleeps in the second bed when the first is occupied', async () => {
    const far = { name: 'red_bed', position: new Vec3(9, 64, 0) };
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, far],
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toEqual({ status: 'completed', detail: { bed: { x: 9, y: 64, z: 0 } } });
    expect(bot.sleep).toHaveBeenCalledTimes(2);
    expect(moveNear).toHaveBeenLastCalledWith(bot, far.position, 1, expect.anything());
  });

  it('is blocked, naming the count tried, when every nearby bed is occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['Bed is occupied', 'Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toContain('tried 2');
    expect(bot.sleep).toHaveBeenCalledTimes(2);
  });

  it('tries at most eight beds', async () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      name: 'white_bed',
      position: new Vec3(i * 2, 64, 0),
    }));
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks,
      sleepErrors: Array.from({ length: 10 }, () => 'Bed is occupied'),
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(outcome.status === 'failed' && outcome.message).toContain('tried 8');
    expect(bot.sleep).toHaveBeenCalledTimes(8);
  });

  it('stops at a non-blocked failure and does not try the next bed', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [{ ...BED }, { ...OTHER_HALF, name: 'red_bed' }],
      sleepErrors: ['There are monsters nearby'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('maps a monster-nearby rejection to not_possible', async () => {
    const outcome = await sleep(
      fakeBot({
        timeOfDay: 13_000,
        blocks: [{ ...BED }],
        sleepErrors: ['There are monsters nearby'],
      }),
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'There are monsters nearby',
    });
  });

  it('maps an occupied bed to blocked', async () => {
    const outcome = await sleep(
      fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }], sleepErrors: ['Bed is occupied'] }),
    );
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
  });

  it('is cancelled when the walk is cancelled', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'cancelled',
      message: 'stopped',
    });
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [{ ...BED }] });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('cancelled');
    expect(bot.sleep).not.toHaveBeenCalled();
  });
});
