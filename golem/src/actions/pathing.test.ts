import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyPathError, type MoveResult, moveNear } from './pathing.ts';

/** The parts of a bot that `moveNear` reads; `pathfinder` is set, so the plugin is not loaded. */
interface FakeBot {
  entity: { position: Vec3 };
  time: { age: number };
  pathfinder: {
    goto: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setGoal: ReturnType<typeof vi.fn>;
  };
}

/** A bot that never finishes a path unless a test resolves or rejects it. */
function fakeBot(): FakeBot {
  return {
    entity: { position: new Vec3(0, 64, 0) },
    time: { age: 0 },
    pathfinder: {
      goto: vi.fn(() => new Promise<void>(() => undefined)),
      stop: vi.fn(),
      setGoal: vi.fn(),
    },
  };
}

function asBot(fake: FakeBot): Bot {
  return fake as unknown as Bot;
}

/** An error the way mineflayer-pathfinder raises them: a name on an Error. */
function pathError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

describe('classifyPathError', () => {
  it('maps NoPath and Timeout to blocked, and GoalChanged to interrupted', () => {
    expect(classifyPathError(pathError('NoPath'))).toBe('blocked');
    expect(classifyPathError(pathError('Timeout'))).toBe('blocked');
    expect(classifyPathError(pathError('GoalChanged'))).toBe('interrupted');
  });

  it('returns null for any other error, so the caller can rethrow it', () => {
    expect(classifyPathError(pathError('SomethingElse'))).toBeNull();
    expect(classifyPathError(new Error('no name'))).toBeNull();
    expect(classifyPathError(undefined)).toBeNull();
  });
});

describe('moveNear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves ok with the distance left to the target when the path finishes', async () => {
    const fake = fakeBot();
    fake.pathfinder.goto = vi.fn(async () => {
      fake.entity.position = new Vec3(9, 64, 0);
    });
    const signal = new AbortController().signal;
    const result = await moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 2, { signal, timeScale: 1 });
    expect(result).toEqual({ ok: true, distance: 1 });
  });

  it('returns blocked once the bot has not moved for stallTicks world ticks, and not before', async () => {
    const fake = fakeBot();
    const signal = new AbortController().signal;
    let settled: MoveResult | undefined;
    void moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
      signal,
      timeScale: 1,
      stallTicks: 600,
    }).then((result) => {
      settled = result;
    });

    // Each 500 ms watchdog tick advances the world clock by 10 ticks while the bot stays put.
    for (let i = 0; i < 59; i++) {
      fake.time.age += 10;
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(settled).toBeUndefined();
    expect(fake.pathfinder.stop).not.toHaveBeenCalled();

    fake.time.age += 10;
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fake.pathfinder.stop).toHaveBeenCalled();
    expect(fake.pathfinder.setGoal).toHaveBeenCalledWith(null);
  });

  it('does not count stall ticks while the bot keeps moving 0.75 blocks per watchdog tick', async () => {
    const fake = fakeBot();
    const signal = new AbortController().signal;
    let settled: MoveResult | undefined;
    void moveNear(asBot(fake), { x: 100, y: 64, z: 0 }, 1, {
      signal,
      timeScale: 1,
      stallTicks: 600,
    }).then((result) => {
      settled = result;
    });

    for (let i = 1; i <= 80; i++) {
      fake.time.age += 10;
      fake.entity.position = new Vec3(i, 64, 0);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(settled).toBeUndefined();
  });

  it('returns blocked when the path search reports NoPath', async () => {
    const fake = fakeBot();
    fake.pathfinder.goto = vi.fn(async () => {
      throw pathError('NoPath');
    });
    const signal = new AbortController().signal;
    const result = await moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, { signal, timeScale: 1 });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
  });

  it('stops the pathfinder and returns cancelled when the signal aborts', async () => {
    const fake = fakeBot();
    const controller = new AbortController();
    const pending = moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
      signal: controller.signal,
      timeScale: 1,
    });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(fake.pathfinder.stop).toHaveBeenCalled();
    // `stop()` alone is deferred; `setGoal(null)` makes the next goto start clean.
    expect(fake.pathfinder.setGoal).toHaveBeenCalledWith(null);
  });

  it('clears its watchdog timer and abort listener however the move ends', async () => {
    const signal = new AbortController().signal;
    const noPath = fakeBot();
    noPath.pathfinder.goto = vi.fn(async () => {
      throw pathError('NoPath');
    });
    await moveNear(asBot(noPath), { x: 10, y: 64, z: 0 }, 1, { signal, timeScale: 1 });
    expect(vi.getTimerCount()).toBe(0);

    const stalled = fakeBot();
    const stalledMove = moveNear(asBot(stalled), { x: 10, y: 64, z: 0 }, 1, {
      signal,
      timeScale: 1,
      stallTicks: 600,
    });
    for (let i = 0; i < 60; i++) {
      stalled.time.age += 10;
      await vi.advanceTimersByTimeAsync(500);
    }
    await stalledMove;
    expect(vi.getTimerCount()).toBe(0);

    const controller = new AbortController();
    const cancelled = moveNear(asBot(fakeBot()), { x: 10, y: 64, z: 0 }, 1, {
      signal: controller.signal,
      timeScale: 1,
    });
    controller.abort();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer and abort listener when goto throws synchronously', async () => {
    const fake = fakeBot();
    fake.pathfinder.goto = vi.fn(() => {
      throw new Error('no pathfinder');
    });
    const controller = new AbortController();
    await expect(
      moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
        signal: controller.signal,
        timeScale: 1,
      }),
    ).rejects.toThrow('no pathfinder');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows an error that is not a pathing outcome', async () => {
    const fake = fakeBot();
    fake.pathfinder.goto = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const signal = new AbortController().signal;
    await expect(
      moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, { signal, timeScale: 1 }),
    ).rejects.toThrow('socket closed');
  });
});
