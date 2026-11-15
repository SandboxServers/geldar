import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { DROWNING_AIR } from '../body/reflexes/hazard-escape.ts';
import { ABORT_AIR, SURFACE_AIR, type SwimController, startSwim, swimNote } from './swim.ts';

describe('swimNote reads right for one block or many (decision 0194 d)', () => {
  it('states the blocks in water and the surfacings as labelled counts, so 1 needs no plural', () => {
    expect(swimNote({ blocksSwum: 1, surfaces: 1 })).toBe(
      'swim: blocks in water 1, surfacings for air 1',
    );
    expect(swimNote({ blocksSwum: 12, surfaces: 2 })).toBe(
      'swim: blocks in water 12, surfacings for air 2',
    );
  });

  it('is undefined when the head never was in water', () => {
    expect(swimNote({ blocksSwum: 0, surfaces: 0 })).toBeUndefined();
  });
});

interface Cell {
  name: string;
  boundingBox: 'block' | 'empty';
}

const WATER: Cell = { name: 'water', boundingBox: 'empty' };
const STONE: Cell = { name: 'stone', boundingBox: 'block' };
const AIR: Cell = { name: 'air', boundingBox: 'empty' };

/** A fake bot in a world of air, with `cells` (keyed `x,y,z`) placed on it. Air is metadata index 1. */
function swimBot(cells: Record<string, Cell>, air: number, at = new Vec3(0.5, 64.2, 0.5)) {
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: at, metadata: [0, air * 15] },
    blockAt: (pos: Vec3) => ({ ...(cells[`${pos.x},${pos.y},${pos.z}`] ?? AIR), position: pos }),
    setControlState: vi.fn(),
    lookAt: vi.fn(async () => undefined),
  });
  return bot as typeof bot & Bot;
}

/** Water in the head cell (0,65,0) of a body at feet y 64.2 (head = floor(64.2 + 1.62)). */
const HEAD_WATER = { '0,65,0': WATER };

function calls(bot: { setControlState: ReturnType<typeof vi.fn> }, name: string, on: boolean) {
  return bot.setControlState.mock.calls.filter(([n, v]) => n === name && v === on).length;
}

describe('startSwim air budget (decision 0194 a, b)', () => {
  it('holds jump on every physics tick with the head in water at SURFACE_AIR', () => {
    const bot = swimBot(HEAD_WATER, SURFACE_AIR);
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    bot.emit('physicsTick');
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(3);
  });

  it('does nothing above SURFACE_AIR: a swim at air 13 holds no jump', () => {
    const bot = swimBot(HEAD_WATER, SURFACE_AIR + 1);
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(0);
  });

  it('does nothing with the head in air, however low the air', () => {
    const bot = swimBot({}, 3);
    const onAbort = vi.fn();
    startSwim(bot, { onAbort });
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(0);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('steers to a breathing column under a roof instead of holding jump into it', () => {
    // Roof at (0,66,0) over the head cell; (1,64..66,0) is air, so the column is one block east.
    const bot = swimBot({ ...HEAD_WATER, '0,66,0': STONE }, SURFACE_AIR);
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    expect(bot.lookAt).toHaveBeenCalled();
    expect(calls(bot, 'forward', true)).toBe(1);
    expect(calls(bot, 'jump', true)).toBe(0);
  });

  it('steers west to a column one block west of the Body, aiming at its centre', () => {
    // Roof over the head; the nearest passable column is (-1,0), so the centre is (-0.5, 64.2, 0.5).
    const bot = swimBot({ ...HEAD_WATER, '0,66,0': STONE }, SURFACE_AIR);
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    expect(bot.lookAt).toHaveBeenCalledWith(new Vec3(-0.5, 64.2, 0.5), true);
  });

  it('steers north to a column one block north, aiming at its centre', () => {
    // Stone at (-1,65,0) closes the west column, so the nearest is (0,-1): the centre is (0.5, 64.2, -0.5).
    const bot = swimBot({ ...HEAD_WATER, '0,66,0': STONE, '-1,65,0': STONE }, SURFACE_AIR);
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    expect(bot.lookAt).toHaveBeenCalledWith(new Vec3(0.5, 64.2, -0.5), true);
    expect(calls(bot, 'forward', true)).toBe(1);
  });

  it('steers east to a column one block east, aiming at its centre', () => {
    // Stone at head level on the west, north and south closes those columns, so the east one is nearest.
    const bot = swimBot(
      { ...HEAD_WATER, '0,66,0': STONE, '-1,65,0': STONE, '0,65,-1': STONE, '0,65,1': STONE },
      SURFACE_AIR,
    );
    startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    expect(bot.lookAt).toHaveBeenCalledWith(new Vec3(1.5, 64.2, 0.5), true);
  });

  it('keeps jump held after an abort while the head is in water, and releases it once dry (0194 b)', () => {
    const bot = swimBot(HEAD_WATER, ABORT_AIR);
    const swim: SwimController = startSwim(bot, { onAbort: () => swim.stop() });
    bot.emit('physicsTick');
    bot.setControlState.mockClear();
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(1);
    bot.entity.position = new Vec3(0.5, 66.2, 0.5);
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', false)).toBe(1);
    bot.setControlState.mockClear();
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(0);
  });

  it('hands the surface to the reflex at DROWNING_AIR and holds no jump there (0194 b)', () => {
    const bot = swimBot(HEAD_WATER, ABORT_AIR);
    const swim: SwimController = startSwim(bot, { onAbort: () => swim.stop() });
    bot.emit('physicsTick');
    Object.assign(bot.entity, { metadata: [0, DROWNING_AIR * 15] });
    bot.setControlState.mockClear();
    bot.emit('physicsTick');
    expect(calls(bot, 'jump', true)).toBe(0);
  });

  it('does not abort at ABORT_AIR with a bank exit in reach: the swim goes on to the bank', () => {
    // Feet in water at (0,64,0); a dry bank at (1,64,0) with two free cells above it.
    const bot = swimBot({ ...HEAD_WATER, '0,64,0': WATER, '1,64,0': STONE }, ABORT_AIR);
    const onAbort = vi.fn();
    startSwim(bot, { onAbort });
    bot.emit('physicsTick');
    expect(onAbort).not.toHaveBeenCalled();
    expect(calls(bot, 'jump', true)).toBe(1);
  });

  it.each([
    ['-x', { x: -1, z: 0 }],
    ['+z', { x: 0, z: 1 }],
    ['-z', { x: 0, z: -1 }],
  ])('does not abort at ABORT_AIR with a dry bank exit to the %s', (_side, bank) => {
    // Feet in water at (0,64,0); a dry bank one step away with two free cells above it.
    const cells = { ...HEAD_WATER, '0,64,0': WATER, [`${bank.x},64,${bank.z}`]: STONE };
    const bot = swimBot(cells, ABORT_AIR);
    const onAbort = vi.fn();
    startSwim(bot, { onAbort });
    bot.emit('physicsTick');
    expect(onAbort).not.toHaveBeenCalled();
    expect(calls(bot, 'jump', true)).toBe(1);
  });

  it('calls onAbort once at ABORT_AIR with the head in water, and reports the air', () => {
    const bot = swimBot(HEAD_WATER, ABORT_AIR);
    const onAbort = vi.fn();
    startSwim(bot, { onAbort });
    bot.emit('physicsTick');
    bot.emit('physicsTick');
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledWith(ABORT_AIR);
  });

  it('does not abort at ABORT_AIR + 1', () => {
    const bot = swimBot(HEAD_WATER, ABORT_AIR + 1);
    const onAbort = vi.fn();
    startSwim(bot, { onAbort });
    bot.emit('physicsTick');
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('counts a surface when the head leaves the water; stop unhooks and adds no more calls', () => {
    const bot = swimBot(HEAD_WATER, SURFACE_AIR);
    const swim = startSwim(bot, { onAbort: vi.fn() });
    bot.emit('physicsTick');
    // Head now at floor(66.2 + 1.62) = 67, in air: the Body has surfaced and releases its jump.
    bot.entity.position = new Vec3(0.5, 66.2, 0.5);
    bot.emit('physicsTick');
    expect(swim.tally.surfaces).toBe(1);
    expect(calls(bot, 'jump', false)).toBeGreaterThan(0);
    const count = bot.setControlState.mock.calls.length;
    expect(swim.stop()).toBe(swim.tally);
    bot.emit('physicsTick');
    expect(bot.setControlState.mock.calls.length).toBe(count);
  });
});
