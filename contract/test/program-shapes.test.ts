import { describe, expect, it } from 'vitest';
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
