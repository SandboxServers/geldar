import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { bed, fakeBot, sleep } from './sleep.fakes.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** The sleepers line as the server sends it to a player: a game_info message with `with` as ints. */
function players(asleep: number, needed: number) {
  return { translate: 'sleep.players_sleeping', with: [asleep, needed] };
}

/** Sends one message to the fake bot's subscribers, as mineflayer does. */
function say(bot: Bot, message: unknown, position = 'game_info'): void {
  (bot as unknown as { emit(name: string, ...args: unknown[]): boolean }).emit(
    'message',
    message,
    position,
  );
}

/** How many subscribers the fake bot has for `message`. */
function subscribers(bot: Bot): number {
  return (bot as unknown as { listenerCount(name: string): number }).listenerCount('message');
}

/** A night bed: the sleep reaches the bed at 50 ms, so a test can send lines before and after it. */
const NIGHT_BED = { timeOfDay: 13_000, blocks: bed('white_bed', 5), sleepDelayMs: 50 };

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(moveNear).mockClear();
});

describe('sleep reads the sleepers line', () => {
  it('completes with the newest line, sent before and 100 ms after the Body lies down', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    const result = sleep(bot);
    say(bot, players(0, 2));
    await vi.advanceTimersByTimeAsync(150);
    say(bot, players(1, 2));
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toMatchObject({
      status: 'completed',
      detail: { sleepers: { asleep: 1, needed: 2 } },
    });
    expect(subscribers(bot)).toBe(0);
  });

  it('reads skipping_night as skipped', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    const result = sleep(bot);
    say(bot, { translate: 'sleep.skipping_night' });
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toMatchObject({ status: 'completed', detail: { sleepers: 'skipped' } });
  });

  it('waits at most 300 ms after lying down when no line comes, and carries none', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    let settled: unknown;
    const done = sleep(bot).then((outcome) => {
      settled = outcome;
    });
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ status: 'completed' });
    expect((settled as { detail: object }).detail).not.toHaveProperty('sleepers');
    await done;
    expect(subscribers(bot)).toBe(0);
  });

  it('stops its watch after a failure', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: bed('white_bed', 5),
      sleepErrors: ['Bed is occupied'],
    });
    expect(await sleep(bot)).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(subscribers(bot)).toBe(0);
  });

  it('stops its watch when the action is cancelled', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: bed('white_bed', 5), hangSleep: true });
    const abort = new AbortController();
    const result = sleep(bot, 1, abort.signal);
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(subscribers(bot)).toBe(0);
  });

  it('starts no watch when the bot is already asleep', async () => {
    const bot = fakeBot({ asleep: true, blocks: bed('white_bed', 5) });
    expect(await sleep(bot)).toMatchObject({ status: 'completed', detail: {} });
    expect(subscribers(bot)).toBe(0);
  });
});
