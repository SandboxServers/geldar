import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPathError,
  forbidCornerCutting,
  MAX_REPLANS,
  type MoveResult,
  moveNear,
} from './pathing.ts';
import { NO_PATH_TEXT, PARTIAL_TEXT } from './soft-dig.ts';

describe('forbidCornerCutting', () => {
  /** Movements whose foot-level cell at (dx, dz) is solid when `solid` lists it. */
  function movementsWith(solid: string[]) {
    const original = vi.fn();
    return {
      original,
      movements: {
        getBlock: (_node: unknown, dx: number, dy: number, dz: number) => ({
          physical: dy === 0 && solid.includes(`${dx},${dz}`),
        }),
        getMoveDiagonal: original,
      },
    };
  }
  const dir = { x: 1, z: 1 };

  it('keeps the diagonal when both side cells are free', () => {
    const { movements, original } = movementsWith([]);
    forbidCornerCutting(movements);
    movements.getMoveDiagonal({}, dir, []);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('drops the diagonal when either side cell is solid', () => {
    for (const solid of [['1,0'], ['0,1'], ['1,0', '0,1']]) {
      const { movements, original } = movementsWith(solid);
      forbidCornerCutting(movements);
      movements.getMoveDiagonal({}, dir, []);
      expect(original).not.toHaveBeenCalled();
    }
  });
});

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

describe('moveNear stall then replan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advances the world one watchdog step (10 ticks, 500 ms) with the bot standing still. */
  async function still(fake: FakeBot, steps: number): Promise<void> {
    for (let i = 0; i < steps; i++) {
      fake.time.age += 10;
      await vi.advanceTimersByTimeAsync(500);
    }
  }

  it('replans after 60 still ticks, and not at 50', async () => {
    const fake = fakeBot();
    void moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
    });
    await still(fake, 5);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1);
    await still(fake, 1);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(2);
    expect(fake.pathfinder.setGoal).toHaveBeenCalledWith(null);
  });

  it('does not replan while the bot moves more than 0.03 blocks per window', async () => {
    const fake = fakeBot();
    void moveNear(asBot(fake), { x: 100, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
    });
    for (let i = 1; i <= 30; i++) {
      fake.time.age += 10;
      fake.entity.position = new Vec3(i * 0.05, 64, 0);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1);
  });

  it('replans at most MAX_REPLANS times, then the long stall rule fails with blocked', async () => {
    const fake = fakeBot();
    let settled: MoveResult | undefined;
    void moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
      stallTicks: 600,
    }).then((r) => {
      settled = r;
    });
    // 6 replans fit in 6 windows of 60 ticks; the last allowed one is the sixth.
    await still(fake, 6 * 6);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1 + MAX_REPLANS);
    await still(fake, 12);
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1 + MAX_REPLANS);
    expect(settled).toBeUndefined();
    await still(fake, 12);
    expect(settled).toMatchObject({ ok: false, reason: 'blocked' });
  });

  it('ignores the answer of a path that a replan replaced', async () => {
    const fake = fakeBot();
    let rejectFirst: (e: unknown) => void = () => undefined;
    fake.pathfinder.goto = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementation(() => new Promise<void>(() => undefined));
    let settled: MoveResult | undefined;
    void moveNear(asBot(fake), { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
    }).then((r) => {
      settled = r;
    });
    await still(fake, 6);
    rejectFirst(pathError('GoalChanged'));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBeUndefined();
  });

  it('follows the partial path when the goal is unreachable and says partial', async () => {
    const fake = fakeBot() as FakeBot & {
      pathfinder: { getPathTo?: unknown; movements?: unknown };
    };
    fake.pathfinder.goto = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw pathError('NoPath');
      })
      .mockImplementationOnce(async () => {
        fake.entity.position = new Vec3(6.5, 64, 0.5);
      });
    fake.pathfinder.getPathTo = vi.fn(() => ({
      status: 'noPath',
      path: [
        { x: 3, y: 64, z: 0 },
        { x: 6, y: 64, z: 0 },
      ],
    }));
    const result = await moveNear(asBot(fake), { x: 20, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
    });
    expect(result).toMatchObject({ ok: true, partial: true, message: PARTIAL_TEXT });
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(2);
  });

  it('is plain blocked with a fixed text when no partial step exists', async () => {
    const fake = fakeBot() as FakeBot & { pathfinder: { getPathTo?: unknown } };
    fake.pathfinder.goto = vi.fn(async () => {
      throw pathError('NoPath');
    });
    fake.pathfinder.getPathTo = vi.fn(() => ({ status: 'noPath', path: [] }));
    const result = await moveNear(asBot(fake), { x: 20, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'blocked', message: NO_PATH_TEXT });
    expect(fake.pathfinder.goto).toHaveBeenCalledTimes(1);
  });
});
