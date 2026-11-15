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

/** The `detail` of a settled outcome (the tests only read it from completed ones). */
function detailOf(outcome: unknown): object {
  return (outcome as { detail: object }).detail;
}

/** A night bed: the sleep reaches the bed at 50 ms, so a test can send lines before, during and after it. */
const NIGHT_BED = { timeOfDay: 13_000, blocks: bed('white_bed', 5), sleepDelayMs: 50 };

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(moveNear).mockClear();
});

describe('sleep reads the sleepers line', () => {
  it('ignores a line sent before the bed is armed', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    let settled: unknown;
    const done = sleep(bot).then((outcome) => {
      settled = outcome;
    });
    say(bot, players(0, 2));
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ status: 'completed' });
    expect(detailOf(settled)).not.toHaveProperty('sleepers');
    await done;
    expect(subscribers(bot)).toBe(0);
  });

  it('counts a line sent during bot.sleep, and ends without the wait', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    let settled: unknown;
    const done = sleep(bot).then((outcome) => {
      settled = outcome;
    });
    await vi.advanceTimersByTimeAsync(10);
    say(bot, players(1, 2));
    await vi.advanceTimersByTimeAsync(40);
    // The Body lies down at 50 ms; the line is in hand, so the result is out at once, not at 350 ms.
    expect(settled).toMatchObject({
      status: 'completed',
      detail: { sleepers: { asleep: 1, needed: 2 } },
    });
    await done;
    expect(subscribers(bot)).toBe(0);
  });

  it('counts a line 100 ms after the Body lies down, through the wait', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    let settled: unknown;
    const done = sleep(bot).then((outcome) => {
      settled = outcome;
    });
    // The Body lies down at 50 ms; at 149 ms it is still in the wait.
    await vi.advanceTimersByTimeAsync(149);
    expect(settled).toBeUndefined();
    // The line 100 ms after lying down is the wait's answer: it ends the wait at once, not at 350 ms.
    say(bot, players(1, 2));
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({
      status: 'completed',
      detail: { sleepers: { asleep: 1, needed: 2 } },
    });
    await done;
    expect(subscribers(bot)).toBe(0);
  });

  it('ignores a line sent before sleep is called', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    say(bot, players(1, 2));
    const result = sleep(bot);
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toMatchObject({ status: 'completed' });
    expect(detailOf(await result)).not.toHaveProperty('sleepers');
  });

  it('ignores a line sent while the Body walks to the bed', async () => {
    vi.useFakeTimers();
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return { ok: true, distance: 0 };
    });
    const bot = fakeBot(NIGHT_BED);
    const result = sleep(bot);
    await vi.advanceTimersByTimeAsync(50);
    say(bot, players(1, 2));
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ status: 'completed' });
    expect(detailOf(await result)).not.toHaveProperty('sleepers');
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
    expect(detailOf(settled)).not.toHaveProperty('sleepers');
    await done;
    expect(subscribers(bot)).toBe(0);
  });

  it('scales the wait by timeScale: at 10x the wait after lying down is 3000 ms', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    let settled: unknown;
    const done = sleep(bot, 10).then((outcome) => {
      settled = outcome;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(51);
    expect(settled).toMatchObject({ status: 'completed' });
    expect(detailOf(settled)).not.toHaveProperty('sleepers');
    await done;
  });

  it('returns cancelled when the signal aborts during the wait, and stops the watch', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    const abort = new AbortController();
    const result = sleep(bot, 1, abort.signal);
    // The Body lies down at 50 ms and waits for a line; the cancel comes in that wait.
    await vi.advanceTimersByTimeAsync(50);
    abort.abort();
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(subscribers(bot)).toBe(0);
  });

  it('reads skipping_night as skipped', async () => {
    vi.useFakeTimers();
    const bot = fakeBot(NIGHT_BED);
    const result = sleep(bot);
    await vi.advanceTimersByTimeAsync(50);
    say(bot, { translate: 'sleep.skipping_night' });
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toMatchObject({ status: 'completed', detail: { sleepers: 'skipped' } });
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
