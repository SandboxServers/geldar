import { describe, expect, it } from 'vitest';
import { intentWhy } from '../src/outcome-words.ts';
import {
  validateExploreArguments,
  validateExploreCheckpoint,
  validateExploreDetail,
  validateFarmArguments,
  validateFarmCheckpoint,
  validateFarmDetail,
  validatePatrolArguments,
  validatePatrolCheckpoint,
  validatePatrolDetail,
} from '../src/programs.ts';

type Shape = Record<string, unknown>;
type Check = (value: unknown) => { ok: boolean };

const route = [
  { x: 0, y: 64, z: 0 },
  { x: 10, y: 64, z: 0 },
];
const exploreArgs: Shape = { program: 'explore', legs: 6, leg_blocks: 24, avoid_water: true };
const exploreCheckpoint: Shape = {
  legs_done: 2,
  legs: 6,
  leg_blocks: 24,
  avoid_water: true,
  chunks_new: 1,
  visited: [
    [0, 0],
    [1, 0],
  ],
  heading: 'e',
};
const exploreDetail: Shape = { legs: 6, chunks_new: 2, stopped: 'legs' };
const farmArgs: Shape = { program: 'farm', radius: 12, max_cells: 16, replant: true };
const farmCheckpoint: Shape = {
  cells: [[1, 64, 2, 'ripe']],
  next: 1,
  harvested: 1,
  sown: 1,
  skipped: 0,
  skipped_owned: 0,
  skipped_unknown: 0,
  replant: true,
  max_cells: 16,
};
const farmDetail: Shape = {
  harvested: 1,
  sown: 1,
  skipped_owned: 0,
  skipped_unknown: 0,
  stopped: 'done',
};
const patrolArgs: Shape = { program: 'patrol', route, laps: 1, loop: true };
const patrolCheckpoint: Shape = { leg: 1, laps_done: 0, route, loop: true, laps: 1 };
const patrolDetail: Shape = { laps: 1, stopped: 'laps' };

/** A copy of `base` with `key` set to `value`. */
function withKey(base: Shape, key: string, value: unknown): Shape {
  return { ...base, [key]: value };
}

/** Checks the minimum and maximum are accepted and one below and one above are rejected. */
function expectBounds(check: Check, base: Shape, key: string, min: number, max: number): void {
  expect(check(withKey(base, key, min)).ok, `${key} ${min}`).toBe(true);
  expect(check(withKey(base, key, max)).ok, `${key} ${max}`).toBe(true);
  expect(check(withKey(base, key, min - 1)).ok, `${key} ${min - 1}`).toBe(false);
  expect(check(withKey(base, key, max + 1)).ok, `${key} ${max + 1}`).toBe(false);
}

describe('explore shapes', () => {
  it('accepts the examples', () => {
    expect(validateExploreArguments(exploreArgs).ok).toBe(true);
    expect(validateExploreArguments({}).ok).toBe(true);
    expect(validateExploreCheckpoint(exploreCheckpoint).ok).toBe(true);
    expect(validateExploreDetail(exploreDetail).ok).toBe(true);
  });

  it('accepts a null heading and rejects an unknown one', () => {
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'heading', null)).ok).toBe(true);
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'heading', 'x')).ok).toBe(false);
  });

  it('bounds the arguments at, just under and just over the limits', () => {
    expectBounds(validateExploreArguments, exploreArgs, 'legs', 1, 12);
    expectBounds(validateExploreArguments, exploreArgs, 'leg_blocks', 8, 48);
  });

  it('bounds the checkpoint and detail counts', () => {
    expectBounds(validateExploreCheckpoint, exploreCheckpoint, 'legs_done', 0, 12);
    expectBounds(validateExploreCheckpoint, exploreCheckpoint, 'legs', 1, 12);
    expectBounds(validateExploreCheckpoint, exploreCheckpoint, 'leg_blocks', 8, 48);
    expectBounds(validateExploreCheckpoint, exploreCheckpoint, 'chunks_new', 0, 12);
    expectBounds(validateExploreDetail, exploreDetail, 'legs', 0, 12);
    expectBounds(validateExploreDetail, exploreDetail, 'chunks_new', 0, 12);
  });

  it('legs 13 rejected', () => {
    expect(validateExploreArguments(withKey(exploreArgs, 'legs', 13)).ok).toBe(false);
  });

  it('accepts 96 visited chunks and rejects 97', () => {
    const chunks = (n: number) => Array.from({ length: n }, (_, i) => [i, -i]);
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'visited', chunks(96))).ok).toBe(
      true,
    );
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'visited', chunks(97))).ok).toBe(
      false,
    );
  });

  it('97 chunks rejected', () => {
    const many = Array.from({ length: 97 }, (_, i) => [i, 0]);
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'visited', many)).ok).toBe(false);
  });

  it('visited carries integers only', () => {
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'visited', [[1.5, 0]])).ok).toBe(
      false,
    );
  });

  it('rejects an unknown argument', () => {
    expect(validateExploreArguments(withKey(exploreArgs, 'extra', 1)).ok).toBe(false);
  });

  it('accepts only the explore stop values', () => {
    for (const stopped of ['legs', 'no_frontier', 'danger', 'limit']) {
      expect(validateExploreDetail(withKey(exploreDetail, 'stopped', stopped)).ok).toBe(true);
    }
    expect(validateExploreDetail(withKey(exploreDetail, 'stopped', 'done')).ok).toBe(false);
  });

  it('a full checkpoint stays under 2 KiB', () => {
    const full = withKey(
      exploreCheckpoint,
      'visited',
      Array.from({ length: 96 }, (_, i) => [i, -i]),
    );
    expect(JSON.stringify(full).length).toBeLessThan(2048);
  });
});

describe('farm shapes', () => {
  it('accepts the examples', () => {
    expect(validateFarmArguments(farmArgs).ok).toBe(true);
    expect(validateFarmCheckpoint(farmCheckpoint).ok).toBe(true);
    expect(validateFarmDetail(farmDetail).ok).toBe(true);
  });

  it('bounds the radius and cell counts', () => {
    expectBounds(validateFarmArguments, farmArgs, 'radius', 4, 24);
    expectBounds(validateFarmArguments, farmArgs, 'max_cells', 1, 32);
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'next', 0, 32);
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'max_cells', 1, 32);
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'harvested', 0, 32);
    expectBounds(validateFarmDetail, farmDetail, 'sown', 0, 32);
  });

  it('takes a radius, never a position', () => {
    expect(validateFarmArguments(withKey(farmArgs, 'position', { x: 0, y: 64, z: 0 })).ok).toBe(
      false,
    );
  });

  it('rejects an unknown argument', () => {
    expect(validateFarmArguments(withKey(farmArgs, 'extra', 1)).ok).toBe(false);
  });

  it('cells carry integer coordinates and a known state', () => {
    expect(
      validateFarmCheckpoint(withKey(farmCheckpoint, 'cells', [[1.5, 64, 2, 'ripe']])).ok,
    ).toBe(false);
    expect(validateFarmCheckpoint(withKey(farmCheckpoint, 'cells', [[1, 64, 2, 'burnt']])).ok).toBe(
      false,
    );
  });

  it('accepts 32 cells and rejects 33', () => {
    const cell = (i: number) => [i, 64, 0, 'unripe'];
    const at = (n: number) => Array.from({ length: n }, (_, i) => cell(i));
    expect(validateFarmCheckpoint(withKey(farmCheckpoint, 'cells', at(32))).ok).toBe(true);
    expect(validateFarmCheckpoint(withKey(farmCheckpoint, 'cells', at(33))).ok).toBe(false);
  });

  it('accepts only the farm stop values', () => {
    for (const stopped of ['done', 'no_cells', 'no_seeds', 'limit']) {
      expect(validateFarmDetail(withKey(farmDetail, 'stopped', stopped)).ok).toBe(true);
    }
    expect(validateFarmDetail(withKey(farmDetail, 'stopped', 'laps')).ok).toBe(false);
  });
});

describe('patrol shapes', () => {
  it('accepts the examples', () => {
    expect(validatePatrolArguments(patrolArgs).ok).toBe(true);
    expect(validatePatrolCheckpoint(patrolCheckpoint).ok).toBe(true);
    expect(validatePatrolDetail(patrolDetail).ok).toBe(true);
  });

  it('bounds the laps and the leg index', () => {
    expectBounds(validatePatrolArguments, patrolArgs, 'laps', 1, 5);
    expectBounds(validatePatrolCheckpoint, patrolCheckpoint, 'leg', 0, 7);
    expectBounds(validatePatrolCheckpoint, patrolCheckpoint, 'laps_done', 0, 5);
    expectBounds(validatePatrolCheckpoint, patrolCheckpoint, 'laps', 1, 5);
    expectBounds(validatePatrolDetail, patrolDetail, 'laps', 0, 5);
  });

  it('a route is 2 to 8 points', () => {
    const points = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 64, z: 0 }));
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', points(1))).ok).toBe(false);
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', points(2))).ok).toBe(true);
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', points(8))).ok).toBe(true);
  });

  it('9-point route rejected', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ x: i, y: 64, z: 0 }));
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', nine)).ok).toBe(false);
    expect(validatePatrolCheckpoint(withKey(patrolCheckpoint, 'route', nine)).ok).toBe(false);
  });

  it('a route point takes integers only and no extra key', () => {
    const fractional = [
      { x: 0.5, y: 64, z: 0 },
      { x: 1, y: 64, z: 0 },
    ];
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', fractional)).ok).toBe(false);
    const named = [
      { x: 0, y: 64, z: 0, extra: 1 },
      { x: 1, y: 64, z: 0 },
    ];
    expect(validatePatrolArguments(withKey(patrolArgs, 'route', named)).ok).toBe(false);
  });

  it('rejects an unknown argument', () => {
    expect(validatePatrolArguments(withKey(patrolArgs, 'extra', 1)).ok).toBe(false);
  });

  it('accepts only the patrol stop values; the program has no limit of its own', () => {
    for (const stopped of ['laps', 'danger', 'limit']) {
      expect(validatePatrolDetail(withKey(patrolDetail, 'stopped', stopped)).ok).toBe(true);
    }
    expect(validatePatrolDetail(withKey(patrolDetail, 'stopped', 'done')).ok).toBe(false);
  });
});

/** The checkpoint the AN-40 farm program emits (its checkpoint() and resume() keys). */
const emittedFarmCheckpoint: Shape = {
  replant: true,
  max_cells: 16,
  cells: [[1, 64, 2, 'ripe']],
  next: 1,
  harvested: 1,
  sown: 0,
  skipped: 0,
  skipped_owned: 0,
  skipped_unknown: 0,
};

/** A copy of `base` without `key`. */
function withoutKey(base: Shape, key: string): Shape {
  const copy = { ...base };
  delete copy[key];
  return copy;
}

/** Accepts `limit` and `-limit`, refuses one past each. */
function expectBothSigns(accepts: (n: number) => boolean, limit: number, label: string): void {
  expect(accepts(limit), `${label} ${limit}`).toBe(true);
  expect(accepts(-limit), `${label} ${-limit}`).toBe(true);
  expect(accepts(limit + 1), `${label} ${limit + 1}`).toBe(false);
  expect(accepts(-limit - 1), `${label} ${-limit - 1}`).toBe(false);
}

describe('keys, constants and booleans', () => {
  const cases: [string, Check, Shape][] = [
    ['ExploreCheckpoint', validateExploreCheckpoint, exploreCheckpoint],
    ['ExploreDetail', validateExploreDetail, exploreDetail],
    ['FarmCheckpoint', validateFarmCheckpoint, farmCheckpoint],
    ['FarmDetail', validateFarmDetail, farmDetail],
    ['PatrolCheckpoint', validatePatrolCheckpoint, patrolCheckpoint],
    ['PatrolDetail', validatePatrolDetail, patrolDetail],
  ];
  it.each(cases)('%s refuses an unknown key', (_name, check, base) => {
    expect(check(withKey(base, 'extra', 1)).ok).toBe(false);
  });

  it('a start argument needs its own program name', () => {
    expect(validateExploreArguments(withKey(exploreArgs, 'program', 'farm')).ok).toBe(false);
    expect(validateFarmArguments(withKey(farmArgs, 'program', 'explore')).ok).toBe(false);
    expect(validatePatrolArguments(withKey(patrolArgs, 'program', 'explore')).ok).toBe(false);
  });

  it('PatrolArguments without a route is refused', () => {
    expect(validatePatrolArguments({}).ok).toBe(false);
    expect(validatePatrolArguments({ program: 'patrol' }).ok).toBe(false);
  });

  it('a checkpoint without heading or skipped is refused', () => {
    expect(validateExploreCheckpoint(withoutKey(exploreCheckpoint, 'heading')).ok).toBe(false);
    expect(validateFarmCheckpoint(withoutKey(farmCheckpoint, 'skipped')).ok).toBe(false);
  });

  it('loop, avoid_water and replant are booleans', () => {
    expect(validatePatrolCheckpoint(withKey(patrolCheckpoint, 'loop', 'yes')).ok).toBe(false);
    expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'avoid_water', 'yes')).ok).toBe(
      false,
    );
    expect(validateFarmArguments(withKey(farmArgs, 'replant', 'yes')).ok).toBe(false);
  });

  it('a patrol checkpoint route of one point is refused', () => {
    expect(validatePatrolCheckpoint(withKey(patrolCheckpoint, 'route', [route[0]])).ok).toBe(false);
  });

  it('accepts every heading, null included', () => {
    for (const heading of ['n', 'e', 's', 'w', null]) {
      expect(validateExploreCheckpoint(withKey(exploreCheckpoint, 'heading', heading)).ok).toBe(
        true,
      );
    }
  });

  it('accepts each farm cell state', () => {
    for (const state of ['ripe', 'unripe', 'empty']) {
      expect(validateFarmCheckpoint(withKey(farmCheckpoint, 'cells', [[1, 64, 2, state]])).ok).toBe(
        true,
      );
    }
  });

  it('bounds skipped and its split counts', () => {
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'skipped', 0, 32);
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'skipped_owned', 0, 32);
    expectBounds(validateFarmCheckpoint, farmCheckpoint, 'skipped_unknown', 0, 32);
    expectBounds(validateFarmDetail, farmDetail, 'skipped_owned', 0, 32);
    expectBounds(validateFarmDetail, farmDetail, 'skipped_unknown', 0, 32);
  });

  it('replays the checkpoint the AN-40 farm program emits', () => {
    expect(validateFarmCheckpoint(emittedFarmCheckpoint).ok).toBe(true);
  });
});

describe('coordinate and chunk bounds', () => {
  const patrolAt = (point: Shape) => withKey(patrolArgs, 'route', [point, { x: 0, y: 64, z: 0 }]);
  const cellAt = (x: number, y: number, z: number) =>
    withKey(farmCheckpoint, 'cells', [[x, y, z, 'ripe']]);
  const visitedAt = (cx: number, cz: number) => withKey(exploreCheckpoint, 'visited', [[cx, cz]]);

  it('block x and z take ±30000000 and refuse one past, both signs', () => {
    const limit = 30000000;
    expectBothSigns(
      (n) => validatePatrolArguments(patrolAt({ x: n, y: 64, z: 0 })).ok,
      limit,
      'route x',
    );
    expectBothSigns(
      (n) => validatePatrolArguments(patrolAt({ x: 0, y: 64, z: n })).ok,
      limit,
      'route z',
    );
    expectBothSigns((n) => validateFarmCheckpoint(cellAt(n, 64, 0)).ok, limit, 'cell x');
    expectBothSigns((n) => validateFarmCheckpoint(cellAt(0, 64, n)).ok, limit, 'cell z');
  });

  it('block y takes -64 to 320 and refuses one either side', () => {
    const routeY = (y: number) => validatePatrolArguments(patrolAt({ x: 0, y, z: 0 })).ok;
    const cellY = (y: number) => validateFarmCheckpoint(cellAt(0, y, 0)).ok;
    for (const accepts of [routeY, cellY]) {
      expect(accepts(-64)).toBe(true);
      expect(accepts(320)).toBe(true);
      expect(accepts(-65)).toBe(false);
      expect(accepts(321)).toBe(false);
    }
  });

  it('chunk coordinates take ±1875000 and refuse one past, both signs', () => {
    const limit = 1875000;
    expectBothSigns((n) => validateExploreCheckpoint(visitedAt(n, 0)).ok, limit, 'chunk cx');
    expectBothSigns((n) => validateExploreCheckpoint(visitedAt(0, n)).ok, limit, 'chunk cz');
  });
});

describe('intent sentences and worst-case size', () => {
  it('returns the drafted sentences, so a deletion is seen', () => {
    expect(intentWhy('explore', 'not_found')).toBe('You found no new direction to explore nearby.');
    expect(intentWhy('farm', 'missing_materials')).toBe('You have no seeds to plant.');
    expect(intentWhy('patrol', 'blocked')).toBe('The way along the route was blocked.');
  });

  it('worst-case checkpoints stay under 2 KiB', () => {
    const chunks = Array.from({ length: 96 }, (_, i) =>
      i % 2 ? [1875000, -1875000] : [-1875000, 1875000],
    );
    const explore = {
      ...exploreCheckpoint,
      legs_done: 12,
      legs: 12,
      leg_blocks: 48,
      chunks_new: 12,
      visited: chunks,
      heading: 'n',
    };
    const farm = {
      ...farmCheckpoint,
      cells: Array.from({ length: 32 }, (_, i) => [
        i % 2 ? 30000000 : -30000000,
        i % 2 ? 320 : -64,
        -30000000,
        'unripe',
      ]),
      next: 32,
      harvested: 32,
      sown: 32,
      skipped: 32,
      skipped_owned: 32,
      skipped_unknown: 32,
      max_cells: 32,
    };
    const patrol = {
      ...patrolCheckpoint,
      leg: 7,
      laps_done: 5,
      laps: 5,
      loop: false,
      route: Array.from({ length: 8 }, (_, i) => ({
        x: i % 2 ? 30000000 : -30000000,
        y: i % 2 ? 320 : -64,
        z: 30000000,
      })),
    };
    expect(validateExploreCheckpoint(explore).ok).toBe(true);
    expect(validateFarmCheckpoint(farm).ok).toBe(true);
    expect(validatePatrolCheckpoint(patrol).ok).toBe(true);
    expect(JSON.stringify(explore).length).toBeLessThan(2048);
    expect(JSON.stringify(farm).length).toBeLessThan(2048);
    expect(JSON.stringify(patrol).length).toBeLessThan(2048);
  });
});
