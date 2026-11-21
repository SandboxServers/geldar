import { describe, expect, it } from 'vitest';
import {
  checkProgramArguments,
  DEFAULT_BOUNDS,
  ErrorList,
  PHASE0_PROGRAMS,
  PROGRAM_ARGS,
} from './bounds.ts';

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
