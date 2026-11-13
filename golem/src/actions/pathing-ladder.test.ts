import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, type Scene, scriptedBot } from './escape-ladder.fakes.ts';
import { onPathUpdate } from './path-doors.ts';
import { moveNear } from './pathing.ts';

/** The log lines of one move, parsed. */
function logged(sink: { log: ReturnType<typeof vi.fn> }): Record<string, unknown>[] {
  return sink.log.mock.calls.map((call) => JSON.parse(String(call[0])));
}

/**
 * A goto that is stalled at the origin, and a pathfinder whose `setGoal(null)` ends the pending goto
 * with `GoalChanged`, as the library does. The move's watchdog sees 300 ticks of no movement.
 */
function stalledMove(scene: Scene) {
  const { bot, asBot } = scriptedBot(scene);
  const pending: { reject?: (error: unknown) => void } = {};
  const pathfinder = bot.pathfinder as unknown as Record<string, unknown>;
  pathfinder.goto = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        pending.reject = reject;
      }),
  );
  pathfinder.setGoal = vi.fn((goal: unknown) => {
    if (goal === null && pending.reject) pending.reject({ name: 'GoalChanged' });
  });
  const sink = { log: vi.fn(), now: () => 0 };
  const ac = new AbortController();
  const move = moveNear(asBot as Bot, { x: 5, y: 64, z: 5 }, 1, {
    signal: ac.signal,
    timeScale: 1,
    stallTicks: 200,
    diag: sink,
  });
  bot.time.age = 300;
  return { bot, asBot: asBot as Bot, sink, ac, move };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the escape ladder belongs to the goto that started it', () => {
  it('its own setGoal(null) does not end the move: the ladder answers the move', async () => {
    vi.useFakeTimers();
    const { move, bot } = stalledMove({ blocks: {} });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await move;
    expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    expect(result).toMatchObject({ ok: false, reason: 'needs_rescue' });
  });

  it('a ladder whose move is superseded stops before its next rung', async () => {
    vi.useFakeTimers();
    const { move, bot, sink, ac } = stalledMove({ blocks: {} });
    // A new action aborts this move while the first rung (jump) is still running.
    bot.waitForTicks = vi.fn(async () => {
      ac.abort();
    }) as unknown as typeof bot.waitForTicks;
    await vi.advanceTimersByTimeAsync(5000);
    const result = await move;
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    const rungs = logged(sink)
      .filter((line) => line.reason === 'escape_ladder')
      .map((line) => line.rung);
    expect(rungs).toEqual(['jump']);
    expect(bot.dig).not.toHaveBeenCalled();
  });
});

describe('a stall next to a door, or on a found path, runs no ladder', () => {
  it('a door beside the bot: no ladder, and the skip is logged with its reason', async () => {
    vi.useFakeTimers();
    const { move, bot, sink } = stalledMove({
      blocks: { '1,64,0': block('oak_door'), '1,65,0': block('oak_door') },
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await move;
    expect(bot.waitForTicks).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(logged(sink)).toContainEqual(
      expect.objectContaining({ reason: 'ladder_skipped', why: 'door_adjacent' }),
    );
  });

  it('a found path (status success) that stalls on dry land still runs the ladder', async () => {
    vi.useFakeTimers();
    const { move, bot, sink, asBot } = stalledMove({ blocks: {} });
    onPathUpdate(asBot, { status: 'success', path: [] });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await move;
    expect(bot.waitForTicks).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect(logged(sink)).not.toContainEqual(expect.objectContaining({ reason: 'ladder_skipped' }));
  });

  it('the last path succeeded but the bot is in water: the ladder runs', async () => {
    vi.useFakeTimers();
    const { move, bot, sink, asBot } = stalledMove({ blocks: {}, water: true });
    onPathUpdate(asBot, { status: 'success', path: [] });
    await vi.advanceTimersByTimeAsync(5000);
    await move;
    expect(bot.waitForTicks).toHaveBeenCalled();
    expect(logged(sink)).not.toContainEqual(expect.objectContaining({ reason: 'ladder_skipped' }));
  });
});
