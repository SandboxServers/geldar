import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { moveNear } from './pathing.ts';
import { emitStallDiag, watchPathEvents } from './stall-diag.ts';
import {
  pressedAgainstStep,
  pulseJump,
  RECOVERY_COOLDOWN_MS,
  recordRecovery,
  recoveryAllowed,
  stopDigIfDigging,
} from './stall-recovery.ts';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** A goal class of its own, so the diagnostic reads a constructor name. */
class GoalNear {}

interface FakeOptions {
  position?: Vec3;
  solid?: Array<[number, number, number]>;
}

/** A body on a flat world: the cells in `solid` are stone, every other cell is air. */
function fakeBot(options: FakeOptions = {}) {
  const solid = new Set((options.solid ?? []).map(([x, y, z]) => key(x, y, z)));
  const listeners = new Map<string, (value: unknown) => void>();
  return {
    entity: {
      position: options.position ?? new Vec3(0.5, 64, 0.5),
      velocity: new Vec3(0, 0, 0),
      yaw: 0.5,
      pitch: -0.25,
      onGround: true,
      isInWater: false,
    },
    time: { age: 0 },
    controlState: {} as Record<string, boolean>,
    targetDigBlock: undefined as unknown,
    stopDigging: vi.fn(),
    setControlState: vi.fn(),
    blockAt: (pos: Vec3) => {
      const name = solid.has(key(pos.x, pos.y, pos.z)) ? 'stone' : 'air';
      return { name, boundingBox: name === 'stone' ? 'block' : 'empty' };
    },
    on: (event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener);
    },
    emit: (event: string, value: unknown) => listeners.get(event)?.(value),
    pathfinder: {
      goto: vi.fn(() => new Promise<void>(() => undefined)),
      stop: vi.fn(),
      setGoal: vi.fn(),
      isMining: () => false,
      goal: new GoalNear(),
    },
  };
}

type FakeBot = ReturnType<typeof fakeBot>;

function asBot(fake: object): Bot {
  return fake as unknown as Bot;
}

/** A sink that appends each line and reads the test's own clock (ms). */
function sinkFor(lines: string[], clock: { t: number }) {
  return { log: (line: string) => lines.push(line), now: () => clock.t };
}

const FACTS = { reason: 'stall' };

describe('emitStallDiag', () => {
  it('writes one stall_diag line with the body state, goal, blocks and recovery', () => {
    const fake = fakeBot({
      position: new Vec3(10.5, 64, 20.5),
      solid: [
        [10, 64, 19],
        [10, 65, 19],
        [10, 65, 20],
        [11, 64, 20],
        [9, 65, 20],
      ],
    });
    fake.entity.velocity = new Vec3(0.1, 0, 0);
    fake.controlState = { forward: true };
    const lines: string[] = [];
    const emitted = emitStallDiag(
      asBot(fake),
      {
        reason: 'stall',
        stalledTicks: 60,
        msSinceMove: 3000,
        recovery: ['stopDigging', 'replan', 'jump'],
        toward: { x: 10.5, z: 10.5 },
      },
      sinkFor(lines, { t: 0 }),
    );
    expect(emitted).toBe(true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'stall_diag',
      reason: 'stall',
      world_tick: 0,
      position: { x: 10.5, y: 64, z: 20.5 },
      velocity: { x: 0.1, y: 0, z: 0 },
      yaw: 0.5,
      pitch: -0.25,
      on_ground: true,
      in_water: false,
      control: { forward: true },
      is_mining: false,
      dig_in_progress: false,
      goal: 'GoalNear',
      next_nodes: [],
      path_status: null,
      path_reset: null,
      ticks_stalled: 60,
      ms_since_move: 3000,
      recovery: ['stopDigging', 'replan', 'jump'],
      blocks: {
        feet: { north: 'stone', south: 'air', east: 'stone', west: 'air' },
        head: { north: 'stone', south: 'air', east: 'air', west: 'stone' },
        feet_up: 'stone',
        step_up: 'stone',
      },
    });
  });

  it('reports the next three path nodes, the path status and the last path reset', () => {
    const fake = fakeBot();
    watchPathEvents(asBot(fake));
    fake.emit('path_update', {
      status: 'partial',
      path: [
        { x: 0, y: 64, z: 1, toBreak: [{}] },
        { x: 0, y: 65, z: 2 },
        { x: 0, y: 63, z: 3 },
        { x: 0, y: 63, z: 4 },
      ],
    });
    fake.emit('path_reset', 'goalChanged');
    const lines: string[] = [];
    emitStallDiag(asBot(fake), FACTS, sinkFor(lines, { t: 0 }));
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      path_status: 'partial',
      path_reset: 'goalChanged',
      next_nodes: [
        { x: 0, y: 64, z: 1, type: 'dig' },
        { x: 0, y: 65, z: 2, type: 'jump' },
        { x: 0, y: 63, z: 3, type: 'fall' },
      ],
    });
  });

  it('marks dig_in_progress when the bot has a dig target or the pathfinder is mining', () => {
    const fake = fakeBot();
    fake.targetDigBlock = {};
    const lines: string[] = [];
    emitStallDiag(asBot(fake), FACTS, sinkFor(lines, { t: 0 }));
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      dig_in_progress: true,
    });
  });

  it('allows one line per body per 10 s, and each body has its own clock', () => {
    const a = fakeBot();
    const b = fakeBot();
    const clock = { t: 0 };
    const lines: string[] = [];
    const sink = sinkFor(lines, clock);
    expect(emitStallDiag(asBot(a), FACTS, sink)).toBe(true);
    clock.t = 9_999;
    expect(emitStallDiag(asBot(a), FACTS, sink)).toBe(false);
    expect(emitStallDiag(asBot(b), FACTS, sink)).toBe(true);
    expect(lines).toHaveLength(2);
    clock.t = 10_000;
    expect(emitStallDiag(asBot(a), FACTS, sink)).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('puts a read error in the line and still returns true', () => {
    const fake = fakeBot();
    Object.defineProperty(fake, 'time', {
      get() {
        throw new Error('world gone');
      },
    });
    const lines: string[] = [];
    expect(emitStallDiag(asBot(fake), FACTS, sinkFor(lines, { t: 0 }))).toBe(true);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'stall_diag',
      reason: 'stall',
      error: 'world gone',
    });
  });
});

describe('recovery cooldown', () => {
  it('waits 30 s, then 60 s, then 120 s, and 120 s for every later recovery', () => {
    expect(RECOVERY_COOLDOWN_MS).toEqual([30_000, 60_000, 120_000]);
    const body = {};
    expect(recoveryAllowed(body, 0)).toBe(true);
    recordRecovery(body, 0);
    expect(recoveryAllowed(body, 29_999)).toBe(false);
    expect(recoveryAllowed(body, 30_000)).toBe(true);
    recordRecovery(body, 30_000);
    expect(recoveryAllowed(body, 89_999)).toBe(false);
    expect(recoveryAllowed(body, 90_000)).toBe(true);
    recordRecovery(body, 90_000);
    expect(recoveryAllowed(body, 209_999)).toBe(false);
    expect(recoveryAllowed(body, 210_000)).toBe(true);
    recordRecovery(body, 210_000);
    expect(recoveryAllowed(body, 329_999)).toBe(false);
    expect(recoveryAllowed(body, 330_000)).toBe(true);
  });

  it('keeps a separate cooldown for each body', () => {
    const a = {};
    const b = {};
    recordRecovery(a, 0);
    expect(recoveryAllowed(a, 1)).toBe(false);
    expect(recoveryAllowed(b, 1)).toBe(true);
  });
});

describe('stopDigIfDigging', () => {
  it('stops a bot.dig target', () => {
    const fake = fakeBot();
    fake.targetDigBlock = {};
    expect(stopDigIfDigging(asBot(fake))).toBe(true);
    expect(fake.stopDigging).toHaveBeenCalledTimes(1);
  });

  it('stops the pathfinder while it is mining', () => {
    const fake = fakeBot();
    fake.pathfinder.isMining = () => true;
    expect(stopDigIfDigging(asBot(fake))).toBe(true);
    expect(fake.stopDigging).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the bot is not digging', () => {
    const fake = fakeBot();
    expect(stopDigIfDigging(asBot(fake))).toBe(false);
    expect(fake.stopDigging).not.toHaveBeenCalled();
  });

  it('does nothing when the bot has no stopDigging to call', () => {
    const bare = { targetDigBlock: {} } as unknown as Bot;
    expect(stopDigIfDigging(bare)).toBe(false);
  });
});

describe('pressedAgainstStep', () => {
  const SIDES: Array<[string, { x: number; z: number }, [number, number, number]]> = [
    ['north', { x: 0.5, z: -4 }, [0, 64, -1]],
    ['south', { x: 0.5, z: 5 }, [0, 64, 1]],
    ['east', { x: 5, z: 0.5 }, [1, 64, 0]],
    ['west', { x: -4, z: 0.5 }, [-1, 64, 0]],
  ];

  it.each(SIDES)('is true for a one-block step on the %s side', (_side, toward, step) => {
    const fake = fakeBot({ solid: [step] });
    expect(pressedAgainstStep(asBot(fake), toward)).toBe(true);
    expect(pulseJumpFor(fake, toward)).toBe(true);
    expect(fake.setControlState).toHaveBeenCalledWith('jump', true);
  });

  it('is false on flat ground', () => {
    const fake = fakeBot();
    expect(pressedAgainstStep(asBot(fake), { x: 0.5, z: -4 })).toBe(false);
    expect(pulseJumpFor(fake, { x: 0.5, z: -4 })).toBe(false);
    expect(fake.setControlState).not.toHaveBeenCalled();
  });

  it('is false when the cell above the step is solid too (a wall, not a step)', () => {
    const fake = fakeBot({
      solid: [
        [0, 64, -1],
        [0, 65, -1],
      ],
    });
    expect(pressedAgainstStep(asBot(fake), { x: 0.5, z: -4 })).toBe(false);
  });

  it('is false when the cell above the bot head is solid (no room to jump)', () => {
    const fake = fakeBot({
      solid: [
        [0, 64, -1],
        [0, 66, 0],
      ],
    });
    expect(pressedAgainstStep(asBot(fake), { x: 0.5, z: -4 })).toBe(false);
  });
});

/** Calls `pulseJump` on a fake, so the test reads the same way for every side. */
function pulseJumpFor(fake: FakeBot, toward: { x: number; z: number }): boolean {
  return pulseJump(asBot(fake), toward);
}

describe('moveNear stall recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const TARGET = { x: 0, y: 64, z: -10 };
  /** The step in front of the bot on its way north to TARGET. */
  const STEP: Array<[number, number, number]> = [[0, 64, -1]];

  /** Advances the world one watchdog step (10 ticks, 500 ms) with the bot standing still. */
  async function still(fake: FakeBot, steps: number): Promise<void> {
    for (let i = 0; i < steps; i++) {
      fake.time.age += 10;
      await vi.advanceTimersByTimeAsync(500);
    }
  }

  function startMove(fake: FakeBot, lines: string[], signal = new AbortController().signal) {
    return moveNear(asBot(fake), TARGET, 1, {
      signal,
      timeScale: 1,
      stallTicks: 600,
      diag: { log: (line) => lines.push(line), now: () => Date.now() },
    });
  }

  it('stops a dig, re-sets the goal and pulses a jump at a step after 60 still ticks, and logs one line', async () => {
    const fake = fakeBot({ solid: STEP });
    fake.targetDigBlock = {};
    const lines: string[] = [];
    void startMove(fake, lines);
    await still(fake, 5);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1);
    expect(fake.stopDigging).not.toHaveBeenCalled();
    await still(fake, 1);
    expect(fake.stopDigging).toHaveBeenCalledTimes(1);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(2);
    expect(fake.setControlState).toHaveBeenCalledWith('jump', true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      reason: 'stall',
      ticks_stalled: 60,
      dig_in_progress: true,
      recovery: ['stopDigging', 'replan', 'jump'],
    });
  });

  it('resolves ok after the recovery pulse, and releases the jump', async () => {
    const fake = fakeBot({ solid: STEP });
    let arrive: () => void = () => undefined;
    fake.pathfinder.goto = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            arrive = resolve;
          }),
      );
    const pending = startMove(fake, []);
    await still(fake, 6);
    expect(fake.setControlState).toHaveBeenLastCalledWith('jump', true);
    fake.entity.position = new Vec3(0.5, 64, -9.5);
    arrive();
    expect(await pending).toMatchObject({ ok: true });
    expect(fake.setControlState).toHaveBeenLastCalledWith('jump', false);
  });

  it('releases a held jump when the move is aborted, and returns cancelled', async () => {
    const fake = fakeBot({ solid: STEP });
    const controller = new AbortController();
    const pending = startMove(fake, [], controller.signal);
    await still(fake, 6);
    expect(fake.setControlState).toHaveBeenLastCalledWith('jump', true);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    expect(fake.setControlState).toHaveBeenLastCalledWith('jump', false);
  });

  it('recovers once per cooldown: a second stall inside 30 s does not stop a dig again', async () => {
    const fake = fakeBot({ solid: STEP });
    fake.targetDigBlock = {};
    const lines: string[] = [];
    void startMove(fake, lines);
    await still(fake, 6);
    expect(fake.stopDigging).toHaveBeenCalledTimes(1);
    // Move one block east, then stand still for another 60 ticks (about 3.5 s of wall time later).
    fake.entity.position = new Vec3(1.5, 64, 0.5);
    await still(fake, 1);
    await still(fake, 6);
    expect(fake.stopDigging).toHaveBeenCalledTimes(1);
  });

  it('takes no jump when no step is in front, but still replans and logs the replan step', async () => {
    const fake = fakeBot();
    const lines: string[] = [];
    void startMove(fake, lines);
    await still(fake, 6);
    expect(fake.setControlState).not.toHaveBeenCalled();
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ recovery: ['replan'] });
  });

  it('does not recover while the bot creeps more than 0.03 blocks per window', async () => {
    const fake = fakeBot({ solid: STEP });
    fake.targetDigBlock = {};
    void startMove(fake, []);
    for (let i = 1; i <= 12; i++) {
      fake.time.age += 10;
      fake.entity.position = new Vec3(0.5 + i * 0.05, 64, 0.5);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fake.stopDigging).not.toHaveBeenCalled();
  });

  it('logs the full stall as a second line when the move gives up at 600 ticks', async () => {
    const fake = fakeBot({ solid: STEP });
    const lines: string[] = [];
    const pending = startMove(fake, lines);
    await still(fake, 60);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'blocked' });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ reason: 'stall', ticks_stalled: 600 });
  });

  it('logs a NoPath failure with its reason and no recovery steps', async () => {
    const fake = fakeBot();
    fake.pathfinder.goto = vi.fn(async () => {
      throw Object.assign(new Error('NoPath'), { name: 'NoPath' });
    });
    const lines: string[] = [];
    const result = await startMove(fake, lines);
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      reason: 'NoPath',
      ticks_stalled: 0,
      recovery: [],
    });
  });
});
