import { describe, expect, it } from 'vitest';
import {
  validatePlanCheckInput,
  validatePlanCheckResult,
  validateSurveyInput,
  validateSurveyResult,
} from '../src/generated/validators.js';

const box = { from: { x: -4, y: 60, z: -4 }, to: { x: 4, y: 70, z: 4 } };
const plan = {
  palette: { wall: { block: 'stone_bricks', state: { half: 'top' } } },
  steps: [
    { op: 'wall', pal: 'wall', from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 64, z: 0 }, height: 3 },
  ],
  origin: 'here',
};

describe('survey input', () => {
  it('accepts a box with and without layers', () => {
    expect(validateSurveyInput({ box })).toBe(true);
    expect(validateSurveyInput({ box, layers: 1 })).toBe(true);
    expect(validateSurveyInput({ box, layers: 384 })).toBe(true);
  });

  it.each([
    ['zero layers', { box, layers: 0 }],
    ['too many layers', { box, layers: 385 }],
    ['no box', { layers: 4 }],
    ['a box with a third corner', { box: { ...box, via: { x: 0, y: 0, z: 0 } } }],
    ['an unknown key', { box, owner: 'agent_7' }],
  ])('refuses %s', (_name, value) => {
    expect(validateSurveyInput(value)).toBe(false);
  });
});

describe('survey result', () => {
  it('accepts a text reply with unknown runs and a truncation mark', () => {
    expect(validateSurveyResult({ text: 'y64: 3 stone 4 unknown', truncated: false })).toBe(true);
    expect(validateSurveyResult({ text: 'y64: 3 stone 4 unknown', truncated: true })).toBe(true);
  });

  it('accepts a reply of exactly 6000 characters', () => {
    expect(validateSurveyResult({ text: 'a'.repeat(6000), truncated: true })).toBe(true);
  });

  it('refuses a reply over 6000 characters', () => {
    expect(validateSurveyResult({ text: 'a'.repeat(6001), truncated: true })).toBe(false);
  });

  it.each([
    ['an owner field', { text: 'y64: 3 stone', truncated: false, owner: 'agent_7' }],
    ['a missing truncated mark', { text: 'y64: 3 stone' }],
    ['a structured layer instead of text', { layers: [], truncated: false }],
  ])('refuses %s', (_name, value) => {
    expect(validateSurveyResult(value)).toBe(false);
  });
});

describe('plan_check input and result', () => {
  it('accepts a plan to check', () => {
    expect(validatePlanCheckInput({ plan })).toBe(true);
  });

  it.each([
    ['no plan', {}],
    ['a plan with an unknown key', { plan: { ...plan, command: '/fill' } }],
    ['an unknown key on the call', { plan, dry: true }],
  ])('refuses %s', (_name, value) => {
    expect(validatePlanCheckInput(value)).toBe(false);
  });

  const result = {
    cells: 25,
    material_needs: { stone_bricks: { need: 25, have: 10 } },
    unknown_cells: 3,
    estimated_ticks: 400,
    invalid_steps: [{ index: 1, reason: 'height is not an integer' }],
  };

  it('accepts a result and refuses one with a missing count', () => {
    expect(validatePlanCheckResult(result)).toBe(true);
    expect(validatePlanCheckResult({ ...result, unknown_cells: undefined })).toBe(false);
  });

  it('refuses a material need with an unknown key', () => {
    const needs = { stone_bricks: { need: 25, have: 10, reserved: 0 } };
    expect(validatePlanCheckResult({ ...result, material_needs: needs })).toBe(false);
  });
});
