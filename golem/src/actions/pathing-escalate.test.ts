import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, type Scene, scriptedBot } from './escape-ladder.fakes.ts';
import { MAX_REPLANS, moveNear } from './pathing.ts';
import { setOwnerLookup } from './protected-blocks.ts';

/** The log lines of one move, parsed. */
function logged(sink: { log: ReturnType<typeof vi.fn> }): Record<string, unknown>[] {
  return sink.log.mock.calls.map((call) => JSON.parse(String(call[0])));
}

/**
 * A goto that never moves its Body, with a pathfinder whose `setGoal(null)` ends the pending goto
 * with `GoalChanged`, as the library does. The stall limit is high, so only the replan rules fire.
 */
function stuckMove(scene: Scene, target = { x: 5, y: 64, z: 5 }, stallTicks = 2000) {
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
  const move = moveNear(asBot as Bot, target, 1, {
    signal: ac.signal,
    timeScale: 1,
    stallTicks,
    diag: sink,
  });
  return { bot, sink, ac, move };
}

/** Moves the Body's clock on in steps of 10 ticks, one 500 ms watchdog interval per step. */
async function passTicks(bot: { time: { age: number } }, ticks: number): Promise<void> {
  for (let done = 0; done < ticks; done += 10) {
    bot.time.age += 10;
    await vi.advanceTimersByTimeAsync(500);
  }
}

/**
 * Worf's pocket, mirrored: dirt walls north at the feet and the head, a yellow bed west. The goal is
 * north, so the ladder's dig rung digs north. Physics: a held forward key walks the Body north
 * (0.25 blocks a tick) only once the feet cell north is air.
 */
function pocket(extra: Partial<Scene> = {}): Scene {
  return {
    blocks: {
      '0,64,-1': block('dirt'),
      '0,65,-1': block('dirt'),
      '-1,64,0': block('yellow_bed'),
    },
    physics: (s) => {
      if (s.controls.forward && s.blockAt(new Vec3(0, 64, -1)).name === 'air') {
        s.position.z -= 0.25;
      }
    },
    ...extra,
  };
}

const NORTH = { x: 0, y: 64, z: -30 };

afterEach(() => {
  vi.useRealTimers();
  setOwnerLookup(null);
});

describe('decision 0210: identical replans open the escape ladder', () => {
  it('not before the third identical replan; the ladder runs on the stall tick after it', async () => {
    vi.useFakeTimers();
    const { bot, sink, move } = stuckMove(pocket());
    // Recovery at 60 ticks, replans at 120 and 180: three identical replans, no ladder yet.
    await passTicks(bot, 180);
    expect(logged(sink).filter((line) => line.reason === 'escalate')).toHaveLength(0);
    expect(bot.waitForTicks).not.toHaveBeenCalled();
    // The next stall tick (240) escalates once, and the ladder starts with its jump rung.
    await passTicks(bot, 60);
    expect(logged(sink).filter((line) => line.reason === 'escalate')).toEqual([
      { event: 'stall_diag', reason: 'escalate', trigger: 'replans', replans: 3 },
    ]);
    expect(bot.waitForTicks).toHaveBeenCalled();
    // Nothing in this scene frees the Body: every rung fails and the goto ends needs_rescue.
    await vi.advanceTimersByTimeAsync(5000);
    await expect(move).resolves.toMatchObject({ ok: false, reason: 'needs_rescue' });
  });

  it('the escalation reaches the dig rung, which digs north and frees the Body', async () => {
    vi.useFakeTimers();
    const scene = pocket();
    const { bot, sink, ac, move } = stuckMove(scene, NORTH);
    await passTicks(bot, 240);
    await vi.advanceTimersByTimeAsync(5000);
    const rungs = logged(sink).filter((line) => line.reason === 'escape_ladder');
    expect(rungs.map((line) => [line.rung, line.worked])).toEqual([
      ['jump', false],
      ['sprint_jump', false],
      ['dig', true],
    ]);
    expect(bot.dig).toHaveBeenCalledTimes(2);
    expect(scene.blocks?.['0,64,-1']).toBeUndefined();
    expect(bot.entity.position.z).toBeLessThan(0);
    ac.abort();
    await move;
  });

  it("another player's block is not dug: the dig rung refuses it, and the ladder digs nothing", async () => {
    vi.useFakeTimers();
    setOwnerLookup(() => ({ known: true, owner: 'someone_else' }));
    const scene = pocket();
    const { bot, sink, ac, move } = stuckMove(scene, NORTH);
    await passTicks(bot, 240);
    await vi.advanceTimersByTimeAsync(5000);
    expect(logged(sink)).toContainEqual(
      expect.objectContaining({ reason: 'escape_ladder', rung: 'dig', worked: false }),
    );
    expect(bot.dig).not.toHaveBeenCalled();
    expect(scene.blocks?.['0,64,-1']).toBeDefined();
    ac.abort();
    await move;
  });

  it('a door beside the Body skips the ladder on every escalation: the stall limit still ends the goto', async () => {
    vi.useFakeTimers();
    const { bot, sink, move } = stuckMove(
      { blocks: { '1,64,0': block('oak_door'), '1,65,0': block('oak_door') } },
      undefined,
      600,
    );
    await passTicks(bot, 700);
    await expect(move).resolves.toMatchObject({ ok: false, reason: 'blocked' });
    const lines = logged(sink);
    expect(bot.waitForTicks).not.toHaveBeenCalled();
    expect(lines.filter((line) => line.reason === 'escalate')).toHaveLength(0);
    const skips = lines.filter((line) => line.reason === 'ladder_skipped');
    expect(skips.length).toBeGreaterThan(0);
    expect(skips.length).toBeLessThanOrEqual(MAX_REPLANS + 1);
  });
});
