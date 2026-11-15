import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from '../../actions/pathing.ts';
import { fakeBot } from '../body.fakes.ts';
import { type EscapeWalk, findLateralExit, swimUp, walkOutOfHazard } from './hazard-escape.ts';

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

/** A swimmer in a fixed world: held forward moves it `speed` along `dir`, else held jump lifts it by `rise`. */
function swimmerIn(
  world: (v: Vec3) => Block,
  at: Vec3,
  rise: number,
  dir = { dx: 1, dz: 0 },
  speed = 0.2,
) {
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
    if (held.has('forward')) b.entity.position = p.offset(dir.dx * speed, 0, dir.dz * speed);
    else if (held.has('jump')) b.entity.position = p.offset(0, rise, 0);
  };
  return {
    bot: bot as never,
    controls,
    state,
    pos: (): Vec3 => b.entity.position,
    isForward: (): boolean => held.has('forward'),
  };
}

const EAST = { name: 'east', dx: 1, dz: 0 };
const SOUTH = { name: 'south', dx: 0, dz: 1 };
const WEST = { name: 'west', dx: -1, dz: 0 };
const NORTH = { name: 'north', dx: 0, dz: -1 };
const SIDES = [EAST, SOUTH, WEST, NORTH];

/** The whole block cell the Body is in, counted along a side from the open column at the origin. */
function cellAlong(pos: Vec3, side: { dx: number; dz: number }): number {
  return Math.floor(pos.x) * side.dx + Math.floor(pos.z) * side.dz;
}

/**
 * The origin column (water y 58..61) under a stone cap at y 62, a water corridor at y 60..61 out to
 * `distance` along `side`, and the exit there: a lake surface (water to y 61, air above) or a dry shaft.
 */
function capped(side: { dx: number; dz: number }, distance: number, exit: 'lake' | 'shaft') {
  const cells: Record<string, Block> = {};
  for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
  for (let k = 1; k < distance; k++) {
    for (const y of [60, 61]) cells[`${k * side.dx},${y},${k * side.dz}`] = WATER;
  }
  const ex = distance * side.dx;
  const ez = distance * side.dz;
  for (const y of [60, 61]) {
    cells[`${ex},${y},${ez}`] = exit === 'lake' ? WATER : AIR;
  }
  for (const y of [62, 63]) cells[`${ex},${y},${ez}`] = AIR;
  return cells;
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
      event: 'engage',
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

describe('swimUp lateral: lakes, reach, nearest exit, hysteresis and competition', () => {
  it.each(SIDES)('escapes a capped shaft to an open lake surface 6 blocks $name', async (side) => {
    const note = vi.fn();
    const { bot, controls, state, pos } = swimmerIn(
      worldOf(capped(side, 6, 'lake')),
      new Vec3(0.5, 60.2, 0.5),
      0,
      side,
    );
    await swimUp(
      walkFor(bot, () => cellAlong(pos(), side) >= 6, { expired: () => state.ticks >= 80, note }),
    );
    expect(controls).toContain('forward:true');
    expect(cellAlong(pos(), side)).toBeGreaterThanOrEqual(6);
    expect(note).toHaveBeenCalledWith({
      event: 'engage',
      direction: side.name,
      distance: 6,
      dy_gained: 0,
    });
  });

  it('finds no exit 9 blocks away: the search reaches 8 and no further', async () => {
    const note = vi.fn();
    const { bot, controls, state } = swimmerIn(
      worldOf(capped(EAST, 9, 'lake')),
      new Vec3(0.5, 60.2, 0.5),
      0,
    );
    await swimUp(walkFor(bot, () => false, { expired: () => state.ticks >= 30, note }));
    expect(controls).not.toContain('forward:true');
    expect(note).not.toHaveBeenCalled();
  });

  it('engages when the Body gains 0.2 blocks in the 20-tick window, under the 0.3 gain', async () => {
    const note = vi.fn();
    const { bot, controls, state, pos } = swimmerIn(
      worldOf(capped(EAST, 6, 'lake')),
      new Vec3(0.5, 60.2, 0.5),
      0.01,
    );
    await swimUp(
      walkFor(bot, () => cellAlong(pos(), EAST) >= 6, { expired: () => state.ticks >= 80, note }),
    );
    expect(controls).toContain('forward:true');
    expect(note).toHaveBeenCalledTimes(1);
  });

  it('takes the nearer of two reachable exits (east 3 before west 6)', async () => {
    const note = vi.fn();
    // Both exits sit beyond the 4-block breathing-column search, so only the lateral search sees them.
    const cells = capped(WEST, 7, 'lake');
    for (let x = 1; x <= 4; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
    for (let y = 60; y <= 63; y++) cells[`5,${y},0`] = AIR;
    const { bot, controls, state, pos } = swimmerIn(worldOf(cells), new Vec3(0.5, 60.2, 0.5), 0);
    await swimUp(
      walkFor(bot, () => cellAlong(pos(), EAST) >= 5, { expired: () => state.ticks >= 80, note }),
    );
    expect(controls).toContain('forward:true');
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engage', direction: 'east', distance: 5 }),
    );
  });

  it('goes west to the open lake when the nearer east shaft is cut off by stone', async () => {
    const note = vi.fn();
    const cells = capped(WEST, 6, 'lake');
    // A dry shaft 5 east, walled off: the corridor cells at x 1 to 4 stay stone, so it is nearer but unreachable.
    // At 5 it is past the 4-block column search, so the walled shaft is not taken as a column.
    for (let y = 60; y <= 63; y++) cells[`5,${y},0`] = AIR;
    const { bot, controls, state, pos } = swimmerIn(
      worldOf(cells),
      new Vec3(0.5, 60.2, 0.5),
      0,
      WEST,
    );
    await swimUp(
      walkFor(bot, () => cellAlong(pos(), WEST) >= 6, { expired: () => state.ticks >= 80, note }),
    );
    expect(controls).toContain('forward:true');
    expect(cellAlong(pos(), WEST)).toBeGreaterThanOrEqual(6);
    expect(note).toHaveBeenCalledWith(expect.objectContaining({ direction: 'west', distance: 6 }));
  });

  it('keeps the undercut-bank column when it is closer than the lateral exit', async () => {
    // Column at x 4 (water to y 62, so no air above it: not a lateral exit); a dry pocket 6 west.
    const cells: Record<string, Block> = {};
    for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
    for (let x = 1; x <= 4; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
    cells['4,62,0'] = WATER;
    for (let x = -5; x <= -1; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
    cells['-6,60,0'] = WATER;
    cells['-6,61,0'] = AIR;
    cells['-6,62,0'] = AIR;
    const aims: Vec3[] = [];
    // Speed 0.1 a tick (the swim speed): the first 20-tick window closes before the Body reaches the column.
    const { bot, state, pos } = swimmerIn(worldOf(cells), new Vec3(0.5, 60.2, 0.5), 0, EAST, 0.1);
    // Each aim is checked against the Body's x when it was given: the column is east of the Body, and a
    // west lateral target would first step to a cell west of it.
    const froms: number[] = [];
    (bot as unknown as { lookAt: (v: Vec3) => Promise<void> }).lookAt = async (v: Vec3) => {
      aims.push(v);
      froms.push(pos().x);
    };
    await swimUp(
      walkFor(bot, () => cellAlong(pos(), EAST) >= 4, { expired: () => state.ticks >= 60 }),
    );
    expect(aims.length).toBeGreaterThan(0);
    expect(aims.every((aim, i) => aim.x > (froms[i] ?? 0))).toBe(true);
  });

  it('keeps steering on the sideways target after a window that gains 0.3 blocks, drops it at the next', async () => {
    // Look takes a tick (as in the game): windows end at ticks 20, 40, 60. Rising 0.02 a tick from tick 21
    // gains 0.4 in each of windows 2 and 3: window 2 keeps the target (forward held), window 3 drops it.
    const { bot, state, isForward, pos } = swimmerIn(
      worldOf(capped(EAST, 6, 'shaft')),
      new Vec3(0.5, 60.2, 0.5),
      0,
      EAST,
      0.05,
    );
    const b = bot as unknown as {
      waitForTicks: () => Promise<void>;
      lookAt: () => Promise<void>;
      entity: { position: Vec3 };
    };
    const inner = b.waitForTicks;
    let forwardAt45: boolean | null = null;
    let forwardAt65: boolean | null = null;
    b.waitForTicks = async () => {
      await inner();
      if (state.ticks > 20) b.entity.position = pos().offset(0, 0.02, 0);
      if (state.ticks === 45) forwardAt45 = isForward();
      if (state.ticks === 65) forwardAt65 = isForward();
    };
    b.lookAt = async () => {
      await b.waitForTicks();
    };
    await swimUp(
      walkFor(bot, () => false, { expired: () => state.ticks >= 70, tick: () => state.ticks }),
    );
    expect(forwardAt45).toBe(true);
    expect(forwardAt65).toBe(false);
  });
});

describe('findLateralExit: the nearest exit, kept while it is not 2 steps nearer', () => {
  /** Origin column, east corridor to a dry shaft at `east`, west corridor to a lake at 6. */
  function twoExits(east: number) {
    const cells = capped(WEST, 6, 'lake');
    for (let x = 1; x < east; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
    for (let y = 60; y <= 63; y++) cells[`${east},${y},0`] = AIR;
    const world = worldOf(cells);
    return (x: number, y: number, z: number) => world(new Vec3(x, y, z));
  }
  const origin = new Vec3(0.5, 60.2, 0.5);

  it('picks the nearest exit when there is no last target', () => {
    expect(findLateralExit(twoExits(5), origin)).toMatchObject({ direction: 'east', distance: 5 });
  });

  it('keeps the last target when the nearest is only one step nearer', () => {
    // West lake at 6 is kept against an east shaft at 5: 6 is less than 5 + 2.
    expect(findLateralExit(twoExits(5), origin, { x: -6, z: 0 })).toMatchObject({
      x: -6,
      direction: 'west',
      distance: 6,
    });
  });

  it('switches to the nearest when it is 2 steps nearer than the last target', () => {
    // East shaft at 4 against the west lake at 6: 6 is not less than 4 + 2, so the target changes.
    expect(findLateralExit(twoExits(4), origin, { x: -6, z: 0 })).toMatchObject({
      direction: 'east',
      distance: 4,
    });
  });
});

describe('findLateralExit: floors, walls and lava', () => {
  const origin = new Vec3(0.5, 60.2, 0.5);
  /** The cell reader of a fixed world, as findLateralExit takes it. */
  const at =
    (cells: Record<string, Block>) =>
    (x: number, y: number, z: number): Block =>
      worldOf(cells)(new Vec3(x, y, z));
  const LAVA: Block = { name: 'lava', boundingBox: 'empty' };
  const MAGMA: Block = { name: 'magma_block', boundingBox: 'block' };
  const CACTUS: Block = { name: 'cactus', boundingBox: 'block' };
  /** An east corridor to a dry shaft at 5, its floor cell set by the case: a lava or block floor, or a void. */
  function eastOverFloor(floor: Block | 'void'): Record<string, Block> {
    const cells = capped(EAST, 5, 'shaft');
    if (floor === 'void') {
      for (let y = 40; y <= 59; y++) cells[`5,${y},0`] = AIR;
    } else {
      cells['5,59,0'] = floor;
    }
    return cells;
  }
  const FLOORS: Array<[string, Block | 'void']> = [
    ['lava', LAVA],
    ['magma_block', MAGMA],
    ['cactus', CACTUS],
    ['a 20-block void', 'void'],
  ];

  it.each(FLOORS)('rejects a shaft over %s and takes the safe lake 6 west', (_name, floor) => {
    const cells = eastOverFloor(floor);
    Object.assign(cells, capped(WEST, 6, 'lake'));
    const exit = findLateralExit(at(cells), origin);
    expect(exit).toMatchObject({ x: -6, z: 0, direction: 'west', distance: 6 });
  });

  it.each(FLOORS)('finds no exit when the only shaft is over %s', (_name, floor) => {
    expect(findLateralExit(at(eastOverFloor(floor)), origin)).toBeNull();
  });

  it('does not route through an air cell over lava: the corridor to the shaft is blocked there', () => {
    const cells = capped(WEST, 6, 'lake');
    cells['1,60,0'] = WATER;
    cells['1,61,0'] = WATER;
    cells['2,60,0'] = AIR;
    cells['2,61,0'] = AIR;
    cells['2,59,0'] = LAVA;
    cells['3,60,0'] = WATER;
    cells['3,61,0'] = WATER;
    for (let y = 60; y <= 63; y++) cells[`4,${y},0`] = AIR;
    const exit = findLateralExit(at(cells), origin);
    expect(exit).toMatchObject({ x: -6, direction: 'west', distance: 6 });
  });

  it('does not enter lava at feet level: a shaft beyond it is out of reach', () => {
    const cells = capped(WEST, 6, 'lake');
    cells['1,60,0'] = LAVA;
    cells['1,61,0'] = LAVA;
    for (let y = 60; y <= 63; y++) cells[`2,${y},0`] = AIR;
    const exit = findLateralExit(at(cells), origin);
    expect(exit).toMatchObject({ x: -6, direction: 'west', distance: 6 });
  });

  it('routes round a one-cell stone bend: 5 steps, not the straight 3', () => {
    const cells: Record<string, Block> = {};
    for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
    for (const y of [60, 61]) {
      cells[`1,${y},0`] = WATER;
      cells[`1,${y},1`] = WATER;
      cells[`2,${y},1`] = WATER;
      cells[`3,${y},1`] = WATER;
    }
    for (let y = 60; y <= 63; y++) cells[`3,${y},0`] = AIR;
    const exit = findLateralExit(at(cells), origin);
    expect(exit).toMatchObject({ x: 3, z: 0, direction: 'east', distance: 5 });
    expect(exit?.path).toHaveLength(5);
  });

  it('keeps the tie: a column 3 blocks away and a lateral exit 3 steps away give the column', async () => {
    const aims: Vec3[] = [];
    const cells = capped(EAST, 3, 'shaft');
    for (const y of [61, 62]) cells[`-3,${y},0`] = AIR;
    const { bot, state, pos } = swimmerIn(worldOf(cells), origin, 0, EAST, 0);
    (bot as unknown as { lookAt: (v: Vec3) => Promise<void> }).lookAt = async (v: Vec3) => {
      aims.push(v);
    };
    await swimUp(
      walkFor(bot, () => false, {
        expired: () => state.ticks >= 30,
        tick: () => state.ticks,
      }),
    );
    expect(pos().x).toBeCloseTo(0.5);
    expect(aims.at(-1)?.x).toBeLessThan(0.5);
  });

  it('takes the lateral exit 3 steps away over a column 4 blocks away', async () => {
    const aims: Vec3[] = [];
    const cells = capped(EAST, 3, 'shaft');
    for (const y of [61, 62]) cells[`-4,${y},0`] = AIR;
    const { bot, state } = swimmerIn(worldOf(cells), origin, 0, EAST, 0);
    (bot as unknown as { lookAt: (v: Vec3) => Promise<void> }).lookAt = async (v: Vec3) => {
      aims.push(v);
    };
    await swimUp(
      walkFor(bot, () => false, {
        expired: () => state.ticks >= 30,
        tick: () => state.ticks,
      }),
    );
    expect(aims.at(-1)?.x).toBeGreaterThan(0.5);
  });

  /** Runs a swim from the origin for 60 ticks; at tick 24 `change` edits the world. Returns the notes. */
  async function swimWithChange(first: Record<string, Block>, change: Record<string, Block>) {
    const note = vi.fn();
    const cells = first;
    const { bot, state } = swimmerIn(worldOf(cells), origin, 0, EAST, 0);
    // The swim's own window tick needs the game clock: `tick` below is the state tick.
    const b = bot as unknown as { waitForTicks: () => Promise<void> };
    const inner = b.waitForTicks;
    b.waitForTicks = async () => {
      if (state.ticks === 24) Object.assign(cells, change);
      await inner();
    };
    await swimUp(
      walkFor(bot, () => false, {
        expired: () => state.ticks >= 60,
        tick: () => state.ticks,
        note,
      }),
    );
    return note;
  }

  it('keeps the engaged target when the nearest exit is only one step nearer', async () => {
    // East shaft 5 engaged in window 1; a lake 4 west appears at tick 24: 4 + 2 > 5, so the target stays.
    const note = await swimWithChange(capped(EAST, 5, 'shaft'), capped(WEST, 4, 'lake'));
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith(expect.objectContaining({ event: 'engage', direction: 'east' }));
  });

  it('retargets to an exit 2 steps nearer, and labels the change "retarget"', async () => {
    const note = await swimWithChange(capped(EAST, 5, 'shaft'), capped(WEST, 2, 'lake'));
    expect(note).toHaveBeenCalledTimes(2);
    expect(note).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'retarget', direction: 'west', distance: 2 }),
    );
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
