import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { ABORT_AIR, SURFACE_AIR, swimStopText } from './swim.ts';

/**
 * A bot with feet at y 64.2 and, when `headWater`, water in the head cell (0,65,0). The walk never
 * finishes on its own; a test ends it by aborting the signal or by the swim controller's abort.
 */
function swimBot(air: number, headWater: boolean) {
  const cells: Record<string, string> = headWater ? { '0,65,0': 'water' } : {};
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0.5, 64.2, 0.5), metadata: [0, air * 15] },
    time: { age: 0 },
    blockAt: (pos: Vec3) => {
      const name = cells[`${pos.x},${pos.y},${pos.z}`] ?? 'air';
      const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
      return { name, boundingBox, position: pos };
    },
    setControlState: vi.fn(),
    pathfinder: {
      goto: vi.fn(() => new Promise<void>(() => undefined)),
      stop: vi.fn(),
      setGoal: vi.fn(),
    },
  });
  return bot as typeof bot & Bot;
}

function jumpsOn(bot: { setControlState: ReturnType<typeof vi.fn> }): number {
  return bot.setControlState.mock.calls.filter(([n, v]) => n === 'jump' && v === true).length;
}

describe('a completed goto that swam carries the swim fact (decision 0194 d)', () => {
  it('adds blocks swum and times it came up for air to the note of an ok walk', async () => {
    const bot = swimBot(17, true);
    const water = new Set<number>([65]);
    bot.blockAt = ((pos: Vec3) => {
      const name = water.has(pos.y) ? 'water' : 'air';
      return { name, boundingBox: 'empty', position: pos };
    }) as never;
    let arrive: () => void = () => undefined;
    bot.pathfinder.goto = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          arrive = resolve;
        }),
    );
    const pending = moveNear(bot, { x: 2, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
      swim: true,
    });
    bot.emit('physicsTick');
    bot.entity.position = new Vec3(2.5, 64.2, 0.5);
    bot.emit('physicsTick');
    water.clear();
    bot.emit('physicsTick');
    arrive();
    await expect(pending).resolves.toMatchObject({
      ok: true,
      message: 'swim: blocks in water 2, surfacings for air 1',
    });
  });
});

describe('moveNear runs the swim controller for a goto (decision 0194 a, b)', () => {
  it('stops the walk with the air fact when a swim reaches ABORT_AIR with the head in water', async () => {
    const bot = swimBot(ABORT_AIR, true);
    const signal = new AbortController().signal;
    const pending = moveNear(bot, { x: 10, y: 64, z: 0 }, 1, { signal, timeScale: 1, swim: true });
    bot.emit('physicsTick');
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'interrupted',
      message: swimStopText(ABORT_AIR),
    });
    expect(bot.pathfinder.stop).toHaveBeenCalled();
  });

  it('keeps jump held after the abort while the head is in water (decision 0194 b)', async () => {
    const bot = swimBot(ABORT_AIR, true);
    void moveNear(bot, { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
      swim: true,
    });
    bot.emit('physicsTick');
    bot.emit('physicsTick');
    expect(jumpsOn(bot)).toBe(1);
  });

  it('surfaces with jump at SURFACE_AIR and does not stop the walk', async () => {
    const bot = swimBot(SURFACE_AIR, true);
    const ac = new AbortController();
    let settled = false;
    void moveNear(bot, { x: 10, y: 64, z: 0 }, 1, {
      signal: ac.signal,
      timeScale: 1,
      swim: true,
    }).then(() => {
      settled = true;
    });
    bot.emit('physicsTick');
    await new Promise((resolve) => setImmediate(resolve));
    expect(jumpsOn(bot)).toBe(1);
    expect(settled).toBe(false);
    ac.abort();
  });

  it('leaves a walk without swim alone at ABORT_AIR (reflex walks keep their own rule)', async () => {
    const bot = swimBot(ABORT_AIR, true);
    const ac = new AbortController();
    let settled = false;
    void moveNear(bot, { x: 10, y: 64, z: 0 }, 1, { signal: ac.signal, timeScale: 1 }).then(() => {
      settled = true;
    });
    bot.emit('physicsTick');
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(jumpsOn(bot)).toBe(0);
    ac.abort();
  });
});
