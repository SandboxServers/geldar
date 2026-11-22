import { describe, expect, it } from 'vitest';
import {
  validateBreakAction,
  validateBuildPlan,
  validatePlanAction,
  validatePlanProgressPayload,
} from '../src/generated/validators.js';

const box = {
  op: 'box',
  pal: 'wall',
  from: { x: 0, y: 64, z: 0 },
  to: { x: 2, y: 66, z: 2 },
};
const add = {
  do: 'plan',
  op: 'add',
  plan_id: 'house-1',
  palette: { wall: { block: 'oak_planks' } },
  steps: [box],
  origin: 'here',
};

describe('break action', () => {
  it.each([
    ['a block at the origin', { do: 'break', at: { x: 0, y: 64, z: 0 } }],
    ['a negative y inside the world', { do: 'break', at: { x: -5, y: -64, z: 3 } }],
    ['the top of the world', { do: 'break', at: { x: 1, y: 320, z: 1 } }],
  ])('accepts %s', (_name, value) => {
    expect(validateBreakAction(value)).toBe(true);
  });

  it.each([
    ['a y below the world', { do: 'break', at: { x: 0, y: -65, z: 0 } }],
    ['a y above the world', { do: 'break', at: { x: 0, y: 321, z: 0 } }],
    ['a fractional coordinate', { do: 'break', at: { x: 0.5, y: 64, z: 0 } }],
    ['an unknown key', { do: 'break', at: { x: 0, y: 64, z: 0 }, force: true }],
    ['a missing position', { do: 'break' }],
    ['a different verb', { do: 'build', at: { x: 0, y: 64, z: 0 } }],
  ])('refuses %s', (_name, value) => {
    expect(validateBreakAction(value)).toBe(false);
  });
});

describe('plan action', () => {
  it('accepts an add with a box step', () => {
    expect(validatePlanAction(add)).toBe(true);
  });

  it('accepts a chunk with final false and seq', () => {
    expect(validatePlanAction({ ...add, final: false, seq: 0 })).toBe(true);
  });

  it('accepts a geometry step in break form with no palette key', () => {
    const steps = [{ op: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2, break: true }];
    expect(validatePlanAction({ ...add, steps })).toBe(true);
  });

  it('accepts a replace and a cancel of one plan and of all', () => {
    expect(validatePlanAction({ ...add, op: 'replace' })).toBe(true);
    expect(validatePlanAction({ do: 'plan', op: 'cancel', plan_id: 'house-1' })).toBe(true);
    expect(validatePlanAction({ do: 'plan', op: 'cancel', plan_id: 'all' })).toBe(true);
  });

  it.each([
    ['a chunk with final false and no seq', { ...add, final: false }],
    ['an unknown step op', { ...add, steps: [{ ...box, op: 'fill' }] }],
    ['an unknown key on the plan', { ...add, command: '/fill' }],
    ['an unknown key on a step', { ...add, steps: [{ ...box, extra: 1 }] }],
    [
      'a palette entry with an unknown key',
      { ...add, palette: { wall: { block: 'stone', x: 1 } } },
    ],
    [
      'a geometry step with neither pal nor break',
      { ...add, steps: [{ op: 'line', from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 0 } }] },
    ],
    ['a plan id with a space', { ...add, plan_id: 'house 1' }],
    ['a palette key with a capital', { ...add, palette: { Wall: { block: 'stone' } } }],
    ['no steps', { ...add, steps: [] }],
    ['a cancel that carries a palette', { do: 'plan', op: 'cancel', plan_id: 'all', palette: {} }],
    ['an unknown op', { ...add, op: 'remove' }],
  ])('refuses %s', (_name, value) => {
    expect(validatePlanAction(value)).toBe(false);
  });
});

describe('build plan shape', () => {
  it('accepts a plan with a seq and final false', () => {
    expect(
      validateBuildPlan({ palette: { w: { block: 'stone' } }, steps: [box], final: false, seq: 3 }),
    ).toBe(true);
  });

  it('refuses a plan with final false and no seq', () => {
    expect(
      validateBuildPlan({ palette: { w: { block: 'stone' } }, steps: [box], final: false }),
    ).toBe(false);
  });
});

describe('plan_progress payload', () => {
  const payload = {
    plan_id: 'house-1',
    total: 540,
    done: 312,
    placed: 300,
    broken: 12,
    skipped_by_code: { changed: 2, missing_materials: 1 },
    phase: 'waiting_materials',
    next_need: { block: 'oak_planks', count: 4 },
  };

  it('accepts a full payload and one without next_need', () => {
    expect(validatePlanProgressPayload(payload)).toBe(true);
    const { next_need: _unused, ...rest } = payload;
    expect(validatePlanProgressPayload({ ...rest, phase: 'running', skipped_by_code: {} })).toBe(
      true,
    );
  });

  it.each([
    ['an unknown failure code', { ...payload, skipped_by_code: { protected: 1 } }],
    ['an unknown phase', { ...payload, phase: 'sprinting' }],
    ['an owner field', { ...payload, owner: 'agent_7' }],
    ['a negative count', { ...payload, done: -1 }],
    ['a next_need without a count', { ...payload, next_need: { block: 'oak_planks' } }],
  ])('refuses %s', (_name, value) => {
    expect(validatePlanProgressPayload(value)).toBe(false);
  });
});
