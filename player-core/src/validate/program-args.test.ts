import { describe, expect, it } from 'vitest';
import {
  BORDER_MARGIN,
  checkProgramArguments,
  DEFAULT_BOUNDS,
  ErrorList,
  PHASE0_PROGRAMS,
  PROGRAM_ARGS,
} from './bounds.ts';
import { createOutputValidator } from './index.ts';

const check = (program: string, args: Record<string, unknown>) => {
  const errors = new ErrorList();
  checkProgramArguments(program, args, '/a', DEFAULT_BOUNDS, errors);
  return errors.errors;
};
const pt = (x: number) => ({ x, y: 64, z: 0 });

describe('explore, farm and patrol are allowed, with bounded arguments (AN-45a)', () => {
  it('names them in the allow-list and in PROGRAM_ARGS', () => {
    for (const p of ['explore', 'farm', 'patrol']) {
      expect(PHASE0_PROGRAMS, `${p} is allowed`).toContain(p);
      expect(PROGRAM_ARGS[p]).toBeDefined();
    }
  });

  it('accepts the defaults and every bound for explore', () => {
    expect(check('explore', {})).toEqual([]);
    expect(check('explore', { legs: 1, leg_blocks: 8, avoid_water: false })).toEqual([]);
    expect(check('explore', { legs: 12, leg_blocks: 48, avoid_water: true })).toEqual([]);
    expect(check('explore', { legs: 0 })).not.toEqual([]);
    expect(check('explore', { legs: 13 })).not.toEqual([]);
    expect(check('explore', { leg_blocks: 7 })).not.toEqual([]);
    expect(check('explore', { leg_blocks: 49 })).not.toEqual([]);
  });

  it('accepts the defaults and every bound for farm', () => {
    expect(check('farm', {})).toEqual([]);
    expect(check('farm', { radius: 4, max_cells: 1, replant: false })).toEqual([]);
    expect(check('farm', { radius: 24, max_cells: 32, replant: true })).toEqual([]);
    expect(check('farm', { radius: 3 })).not.toEqual([]);
    expect(check('farm', { radius: 25 })).not.toEqual([]);
    expect(check('farm', { max_cells: 0 })).not.toEqual([]);
    expect(check('farm', { max_cells: 33 })).not.toEqual([]);
  });

  it('requires a route of 2 to 8 positions for patrol, and bounds laps', () => {
    const route = (n: number) => Array.from({ length: n }, (_, i) => pt(i));
    expect(check('patrol', {})).not.toEqual([]);
    expect(check('patrol', { route: route(1) })).not.toEqual([]);
    expect(check('patrol', { route: route(2) })).toEqual([]);
    expect(check('patrol', { route: route(8), laps: 5, loop: false })).toEqual([]);
    expect(check('patrol', { route: route(9) })).not.toEqual([]);
    expect(check('patrol', { route: route(2), laps: 0 })).not.toEqual([]);
    expect(check('patrol', { route: route(2), laps: 6 })).not.toEqual([]);
    expect(check('patrol', { route: 'north' })).not.toEqual([]);
    expect(check('patrol', { route: [pt(0), { x: 1.5, y: 64, z: 0 }] })).not.toEqual([]);
    expect(check('patrol', { route: [pt(0), { x: 1, y: 64 }] })).not.toEqual([]);
  });

  it('checks each route point as a position: height, border and unknown keys (a packet-silent choice)', () => {
    const route = (p: Record<string, unknown>) => ({ route: [pt(0), p] });
    const edge = DEFAULT_BOUNDS.worldBorderRadius + BORDER_MARGIN;
    expect(check('patrol', route({ x: edge, y: 320, z: -edge }))).toEqual([]);
    expect(check('patrol', route({ x: 0, y: 321, z: 0 }))).not.toEqual([]);
    expect(check('patrol', route({ x: 0, y: -65, z: 0 }))).not.toEqual([]);
    expect(check('patrol', route({ x: edge + 1, y: 64, z: 0 }))).not.toEqual([]);
    expect(check('patrol', route({ x: 0, y: 64, z: -edge - 1 }))).not.toEqual([]);
    expect(check('patrol', route({ x: 0, y: 64, z: 0, w: 1 }))).not.toEqual([]);
  });

  it('accepts only true or false for a bool', () => {
    for (const bad of ['true', 1, 0, null]) {
      expect(check('explore', { avoid_water: bad }), String(bad)).not.toEqual([]);
      expect(check('farm', { replant: bad }), String(bad)).not.toEqual([]);
      expect(check('patrol', { route: [pt(0), pt(1)], loop: bad }), String(bad)).not.toEqual([]);
    }
  });

  it('refuses a fourth, unknown argument for each program', () => {
    expect(check('explore', { legs: 2, leg_blocks: 8, avoid_water: true, speed: 1 })).not.toEqual(
      [],
    );
    expect(check('farm', { radius: 4, max_cells: 2, replant: true, field: 1 })).not.toEqual([]);
    expect(check('patrol', { route: [pt(0), pt(1)], laps: 1, loop: true, x: 1 })).not.toEqual([]);
  });
});

describe('explore, farm and patrol through the whole output validator (AN-45a)', () => {
  const validator = createOutputValidator();
  const thought = (program: string, args: Record<string, unknown>) =>
    validator.parseThought(
      JSON.stringify({
        reasoning: 'ok',
        intent: {
          goal: 'look_around',
          program,
          arguments: args,
          wake_on: ['goal_completed'],
          limits: { max_world_ticks: 6000, max_block_operations: 100 },
        },
      }),
    );

  it('accepts a valid intent for each program', () => {
    expect(thought('explore', { legs: 3, leg_blocks: 24, avoid_water: true }).ok).toBe(true);
    expect(thought('farm', { radius: 12, max_cells: 16, replant: true }).ok).toBe(true);
    expect(thought('patrol', { route: [pt(0), pt(5)], laps: 2, loop: false }).ok).toBe(true);
  });

  it('accepts the bound values for each program through the whole validator', () => {
    const eight = Array.from({ length: 8 }, (_, i) => pt(i));
    expect(thought('explore', { legs: 12, leg_blocks: 48, avoid_water: true }).ok).toBe(true);
    expect(thought('explore', { legs: 1, leg_blocks: 8 }).ok).toBe(true);
    expect(thought('farm', { radius: 24, max_cells: 32, replant: true }).ok).toBe(true);
    expect(thought('farm', { radius: 4, max_cells: 1 }).ok).toBe(true);
    expect(thought('patrol', { route: eight, laps: 5, loop: true }).ok).toBe(true);
    expect(thought('patrol', { route: [pt(0), pt(1)], laps: 1 }).ok).toBe(true);
  });

  it('refuses bad arguments for each program', () => {
    expect(thought('explore', { legs: 99 }).ok).toBe(false);
    expect(thought('farm', { radius: 2 }).ok).toBe(false);
    expect(thought('patrol', { route: [pt(0)] }).ok).toBe(false);
    expect(thought('patrol', {}).ok).toBe(false);
    expect(thought('explore', { speed: 1 }).ok).toBe(false);
  });

  it('still refuses a program that is not on the allow-list', () => {
    expect(thought('trade_wait', {}).ok).toBe(false);
    expect(thought('dance', {}).ok).toBe(false);
  });
});
