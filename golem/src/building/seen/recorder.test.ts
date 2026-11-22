import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type ViewPose,
  type ViewWorld,
} from '../../perception/view/viewport.ts';
import {
  newRecorder,
  RAY_BUDGET,
  RECORD_EVERY_TICKS,
  recordChange,
  recordSeen,
  type SeenRecorder,
} from './recorder.ts';
import { SeenMap } from './section.ts';

const EYE: ViewPose = { x: 0.5, y: 64.5, z: 0.5, yaw: 0, pitch: 0 };

/** Casts the whole cone: one sampled tick per budget slice, from `tick` on. */
function sweep(rec: SeenRecorder, world: ViewWorld, pose: ViewPose, tick: number): void {
  const slices = Math.ceil((DEFAULT_COLS * DEFAULT_ROWS) / RAY_BUDGET);
  for (let i = 0; i < slices; i++) recordSeen(rec, world, pose, tick + i * RECORD_EVERY_TICKS);
}

interface FakeOptions {
  /** Cells named here are solid stone; any other cell is air. */
  stone?: Array<[number, number, number]>;
  /** Cells for which the chunk is not loaded. */
  unloaded?: (x: number, y: number, z: number) => boolean;
  dark?: boolean;
}

function fakeWorld(opts: FakeOptions = {}): ViewWorld & { calls: number } {
  const stone = new Set((opts.stone ?? []).map((c) => c.join(',')));
  const world = {
    dark: opts.dark ?? false,
    mobs: [],
    calls: 0,
    block(x: number, y: number, z: number) {
      world.calls++;
      if (opts.unloaded?.(x, y, z)) return { kind: 'unknown' as const };
      if (stone.has(`${x},${y},${z}`)) return { kind: 'solid' as const, name: 'stone' };
      return { kind: 'air' as const, name: 'air' };
    },
  };
  return world;
}

/** A stone wall across the view at z = -3, and a stone block behind it at z = -6. */
function wallWorld(): ViewWorld {
  const wall: Array<[number, number, number]> = [];
  for (let x = -10; x <= 10; x++) for (let y = 62; y <= 68; y++) wall.push([x, y, -3]);
  wall.push([0, 64, -6]);
  return fakeWorld({ stone: wall });
}

describe('recordSeen: line of sight', () => {
  it('records the first opaque block and stops; a block behind a wall is not recorded', () => {
    const map = new SeenMap();
    const rec = newRecorder(map);
    recordSeen(rec, wallWorld(), EYE, 0);
    expect(map.read(0, 64, -3)?.name).toBe('stone');
    expect(map.read(0, 64, -6)).toBeUndefined();
    for (let z = -4; z >= -24; z--) expect(map.read(0, 64, z)).toBeUndefined();
  });

  it('records the transparent blocks in front of the wall as air', () => {
    const map = new SeenMap();
    sweep(newRecorder(map), wallWorld(), EYE, 0);
    expect(map.read(0, 64, -1)).toMatchObject({ name: 'air' });
    expect(map.read(0, 64, -2)).toMatchObject({ name: 'air' });
  });
});

describe('recordSeen: loaded chunks', () => {
  it('never records a cell in an unloaded chunk', () => {
    const map = new SeenMap();
    const world = fakeWorld({ unloaded: (_x, _y, z) => z <= -5 });
    sweep(newRecorder(map), world, EYE, 0);
    expect(map.read(0, 64, -2)?.name).toBe('air');
    for (let z = -5; z >= -24; z--) expect(map.read(0, 64, z)).toBeUndefined();
  });
});

describe('recordSeen: dark range', () => {
  it('records a solid block within 6 blocks in the dark', () => {
    const map = new SeenMap();
    sweep(newRecorder(map), fakeWorld({ dark: true, stone: [[0, 64, -4]] }), EYE, 0);
    expect(map.read(0, 64, -4)?.name).toBe('stone');
  });

  it('does not record a block beyond 6 blocks in the dark, though it is recorded in light', () => {
    const stone: Array<[number, number, number]> = [[0, 64, -8]];
    const dark = new SeenMap();
    sweep(newRecorder(dark), fakeWorld({ dark: true, stone }), EYE, 0);
    expect(dark.read(0, 64, -8)).toBeUndefined();
    const lit = new SeenMap();
    sweep(newRecorder(lit), fakeWorld({ stone }), EYE, 0);
    expect(lit.read(0, 64, -8)?.name).toBe('stone');
  });
});

describe('recordSeen: timing and last-seen', () => {
  it('does nothing on a tick that is not a multiple of the interval', () => {
    const map = new SeenMap();
    const world = fakeWorld();
    expect(recordSeen(newRecorder(map), world, EYE, 5)).toBe(0);
    expect(world.calls).toBe(0);
    expect(map.sectionCount).toBe(0);
  });

  it('updates the last-seen tick when a cell is looked at again', () => {
    const map = new SeenMap();
    const rec = newRecorder(map);
    recordSeen(rec, fakeWorld(), EYE, 0);
    expect(map.read(0, 64, -2)?.lastSeen).toBe(0);
    recordSeen(rec, fakeWorld(), EYE, 10);
    expect(map.read(0, 64, -2)?.lastSeen).toBe(10);
  });

  it('a wrong interval or budget is refused', () => {
    expect(() => newRecorder(new SeenMap(), { everyTicks: 0 })).toThrow(RangeError);
    expect(() => newRecorder(new SeenMap(), { rayBudget: 0 })).toThrow(RangeError);
  });
});

describe('recordSeen: ray budget', () => {
  it('uses the default budget and casts the whole cone in a few sampled ticks', () => {
    const total = DEFAULT_COLS * DEFAULT_ROWS;
    const rec = newRecorder(new SeenMap());
    let cast = 0;
    for (let tick = 0; cast < total; tick += 10) cast += recordSeen(rec, fakeWorld(), EYE, tick);
    expect(cast).toBe(Math.ceil(total / RAY_BUDGET) * RAY_BUDGET);
  });

  it('never casts more rays in one tick than the budget, and bounds the block reads', () => {
    const budget = 8;
    const rec = newRecorder(new SeenMap(), { rayBudget: budget });
    for (let tick = 0; tick < 300; tick += 10) {
      const world = fakeWorld();
      const cast = recordSeen(rec, world, EYE, tick);
      expect(cast).toBeLessThanOrEqual(budget);
      // A ray reads at most one block per 0.25 step over 24 blocks, so 96 reads.
      expect(world.calls).toBeLessThanOrEqual(budget * 96);
    }
  });
});

describe('recordChange', () => {
  it('records a block the Body placed or broke', () => {
    const map = new SeenMap();
    recordChange(map, 3, 70, -2, 'oak_planks', 7);
    expect(map.read(3, 70, -2)).toEqual({ name: 'oak_planks', lastSeen: 7 });
    recordChange(map, 3, 70, -2, 'air', 9);
    expect(map.read(3, 70, -2)).toEqual({ name: 'air', lastSeen: 9 });
  });
});
