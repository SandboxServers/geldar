import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from '../../actions/pathing.ts';
import { fakeBot } from '../body.fakes.ts';
import { type EscapeWalk, swimUp, walkOutOfHazard } from './hazard-escape.ts';

vi.mock('../../actions/pathing.ts', () => ({ moveNear: vi.fn() }));

const move = vi.mocked(moveNear);

beforeEach(() => {
  move.mockReset();
  move.mockResolvedValue({ ok: true, distance: 1 });
});

/** A bot that logs its control states and counts the ticks it waited. */
function controlBot(at = new Vec3(0.5, 64, 0.5)) {
  const bot = fakeBot() as unknown as Record<string, unknown>;
  const controls: string[] = [];
  const state = { ticks: 0 };
  (bot.entity as { position: Vec3 }).position = at;
  bot.setControlState = (name: string, on: boolean) => controls.push(`${name}:${on}`);
  bot.lookAt = async () => undefined;
  bot.waitForTicks = async () => {
    state.ticks += 1;
  };
  return { bot: bot as never, controls, state };
}

function walkFor(bot: never, reachedAfter: () => boolean, extra: Partial<EscapeWalk> = {}) {
  return {
    bot,
    target: { x: 3, y: 64, z: 0 },
    signal: new AbortController().signal,
    timeScale: 2,
    expired: () => false,
    reached: reachedAfter,
    ...extra,
  } as EscapeWalk;
}

describe('swimUp', () => {
  it('holds jump until the Body is out of the water, then lets go', async () => {
    const { bot, controls, state } = controlBot();
    await swimUp(walkFor(bot, () => state.ticks >= 3));
    expect(controls).toEqual(['jump:true', 'jump:false']);
    expect(state.ticks).toBe(3);
  });

  it('stops on abort and on expiry, and releases jump', async () => {
    const aborted = controlBot();
    const controller = new AbortController();
    controller.abort();
    await swimUp(walkFor(aborted.bot, () => false, { signal: controller.signal }));
    expect(aborted.controls).toEqual(['jump:true', 'jump:false']);
    expect(aborted.state.ticks).toBe(0);

    const expired = controlBot();
    await swimUp(walkFor(expired.bot, () => false, { expired: () => true }));
    expect(expired.controls.at(-1)).toBe('jump:false');
    expect(expired.state.ticks).toBe(0);
  });

  it('steers west out from under a ceiling to the open column, then rises', async () => {
    // Water at y 58..59 under a stone ceiling at y 60 over x 0; x -1 is open water up to y 60.
    const { bot, controls, state } = controlBot(new Vec3(0.5, 58.2, 0.5));
    (bot as unknown as { blockAt: (v: Vec3) => unknown }).blockAt = (v: Vec3) =>
      v.x === 0 && v.y === 60 && v.z === 0
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'water', boundingBox: 'empty' };
    const entity = bot as unknown as { entity: { position: Vec3 } };
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      if (controls.includes('forward:true')) {
        entity.entity.position = entity.entity.position.offset(-0.5, 0, 0);
      }
    };
    await swimUp(walkFor(bot, () => state.ticks >= 6));
    expect(controls[0]).toBe('jump:true');
    expect(controls).toContain('forward:true');
    expect(controls.at(-2)).toBe('forward:false');
    expect(controls.at(-1)).toBe('jump:false');
    expect(entity.entity.position.x).toBeLessThan(0);
  });

  it('steers north (-z) to the open column under a ceiling, aiming at its centre', async () => {
    // Stone ceiling at y 60 over x -1..1, z -1..1, except the open column at (0, -1): north is the only way out.
    const { bot, controls, state } = controlBot(new Vec3(0.5, 58.2, 0.5));
    const aims: Vec3[] = [];
    const ceiling = (v: Vec3) =>
      v.y === 60 && Math.abs(v.x) <= 1 && Math.abs(v.z) <= 1 && !(v.x === 0 && v.z === -1);
    (bot as unknown as { blockAt: (v: Vec3) => unknown }).blockAt = (v: Vec3) =>
      ceiling(v)
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'water', boundingBox: 'empty' };
    const entity = bot as unknown as { entity: { position: Vec3 } };
    (bot as unknown as { lookAt: (v: Vec3) => Promise<void> }).lookAt = async (v: Vec3) => {
      aims.push(v);
    };
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      if (controls.includes('forward:true')) {
        entity.entity.position = entity.entity.position.offset(0, 0, -0.5);
      }
    };
    await swimUp(walkFor(bot, () => state.ticks >= 2));
    expect(controls).toContain('forward:true');
    expect(aims.length).toBeGreaterThan(0);
    expect(aims.every((aim) => aim.x === 0.5 && aim.z === -0.5)).toBe(true);
    expect(entity.entity.position.z).toBeLessThan(0.5);
  });

  it('keeps jump held on a physics tick that follows a control reset', async () => {
    const { bot, controls, state } = controlBot();
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
    };
    await swimUp(walkFor(bot, () => state.ticks >= 3));
    expect(controls.filter((c) => c === 'jump:true').length).toBeGreaterThanOrEqual(3);
    expect(controls.at(-1)).toBe('jump:false');
  });
});

type Block = { name: string; boundingBox: string };
const STONE: Block = { name: 'stone', boundingBox: 'block' };
const WATER: Block = { name: 'water', boundingBox: 'empty' };
const AIR: Block = { name: 'air', boundingBox: 'empty' };

/** Stone everywhere except the listed cells, keyed "x,y,z". */
function worldOf(cells: Record<string, Block>): (v: Vec3) => Block {
  return (v) => cells[`${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`] ?? STONE;
}

/** A 1-wide water column at x 0, z 0 (y 58..61) under a stone cap at y 62. A water corridor at y 60..61 runs east to an open shaft at x 6. */
function cappedWorld(): Record<string, Block> {
  const cells: Record<string, Block> = {};
  for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
  for (let x = 1; x <= 5; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
  for (let y = 60; y <= 63; y++) cells[`6,${y},0`] = AIR;
  return cells;
}

/** A swimmer in a fixed world: held forward moves it 0.2 east, else held jump lifts it by `rise`. */
function swimmerIn(world: (v: Vec3) => Block, at: Vec3, rise: number) {
  const { bot, controls, state } = controlBot(at);
  const held = new Set<string>();
  const b = bot as unknown as {
    setControlState: (name: string, on: boolean) => void;
    blockAt: (v: Vec3) => Block;
    waitForTicks: () => Promise<void>;
    entity: { position: Vec3 };
  };
  b.setControlState = (name, on) => {
    controls.push(`${name}:${on}`);
    if (on) held.add(name);
    else held.delete(name);
  };
  b.blockAt = (v) => world(v);
  b.waitForTicks = async () => {
    state.ticks += 1;
    const p = b.entity.position;
    if (held.has('forward')) b.entity.position = p.offset(0.2, 0, 0);
    else if (held.has('jump')) b.entity.position = p.offset(0, rise, 0);
  };
  return { bot: bot as never, controls, state, pos: (): Vec3 => b.entity.position };
}

describe('swimUp lateral fallback', () => {
  it('steers east along the corridor to the open shaft when the column is capped', async () => {
    const note = vi.fn();
    const { bot, controls, state, pos } = swimmerIn(
      worldOf(cappedWorld()),
      new Vec3(0.5, 60.2, 0.5),
      0,
    );
    await swimUp(walkFor(bot, () => pos().x >= 6, { expired: () => state.ticks >= 80, note }));
    expect(controls).toContain('forward:true');
    expect(pos().x).toBeGreaterThanOrEqual(6);
    expect(state.ticks).toBeLessThan(80);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith({
      direction: 'east',
      distance: 6,
      dy_gained: 0,
    });
  });

  it('releases forward and jump when it expires in the middle of the sideways swim', async () => {
    const { bot, controls, state } = swimmerIn(worldOf(cappedWorld()), new Vec3(0.5, 60.2, 0.5), 0);
    await swimUp(walkFor(bot, () => false, { expired: () => state.ticks >= 30 }));
    expect(controls).toContain('forward:true');
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
  });

  it('does not steer sideways when an open column rises 0.2 a tick', async () => {
    const note = vi.fn();
    const world = {
      '0,58,0': WATER,
      '0,59,0': WATER,
      '0,60,0': WATER,
      '0,61,0': WATER,
      '0,62,0': AIR,
    };
    const { bot, controls, pos } = swimmerIn(worldOf(world), new Vec3(0.5, 58.2, 0.5), 0.2);
    await swimUp(walkFor(bot, () => pos().y >= 61.5, { note }));
    expect(controls).not.toContain('forward:true');
    expect(note).not.toHaveBeenCalled();
    expect(pos().y).toBeGreaterThanOrEqual(61.5);
  });

  it('does not engage when the Body gains 0.3 blocks or more in the 20-tick window', async () => {
    const note = vi.fn();
    // Pinned under the cap, but rising 0.02 a tick: 0.4 blocks in the window.
    const { bot, controls, state } = swimmerIn(
      worldOf(cappedWorld()),
      new Vec3(0.5, 59.8, 0.5),
      0.02,
    );
    await swimUp(walkFor(bot, () => false, { expired: () => state.ticks >= 21, note }));
    expect(controls).not.toContain('forward:true');
    expect(note).not.toHaveBeenCalled();
  });
});

describe('walkOutOfHazard', () => {
  it('walks with the pathfinder at the time scale, then steers with jump held until out', async () => {
    const { bot, controls, state } = controlBot();
    await walkOutOfHazard(walkFor(bot, () => state.ticks >= 2));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]?.[3]).toMatchObject({ digTier: false, timeScale: 2, stallTicks: 40 });
    expect(controls).toContain('forward:true');
    expect(controls).toContain('jump:true');
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
    expect(state.ticks).toBe(2);
  });

  it('holds jump on each physics tick while the Body is in water, during the pathfinder walk', async () => {
    const { bot, controls } = controlBot();
    (bot as unknown as { entity: { isInWater: boolean } }).entity.isInWater = true;
    move.mockImplementationOnce(async () => {
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
      return { ok: true, distance: 1 };
    });
    await walkOutOfHazard(walkFor(bot, () => true));
    expect(controls).toEqual(['jump:true', 'forward:false', 'jump:false']);
  });

  it('does not hold jump on physics ticks when the Body is out of the water', async () => {
    const { bot, controls } = controlBot();
    move.mockImplementationOnce(async () => {
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
      return { ok: true, distance: 1 };
    });
    await walkOutOfHazard(walkFor(bot, () => true));
    expect(controls).toEqual(['forward:false', 'jump:false']);
  });

  it('does not steer into lava the Body is not already in', async () => {
    const { bot, controls, state } = controlBot();
    (bot as unknown as { blockAt: () => unknown }).blockAt = () => ({
      name: 'lava',
      boundingBox: 'empty',
    });
    await walkOutOfHazard(walkFor(bot, () => false));
    expect(controls).not.toContain('forward:true');
    expect(state.ticks).toBe(0);
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
  });
});
