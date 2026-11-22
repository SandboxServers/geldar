import { describe, expect, it } from 'vitest';
import { planActivityLines, toPlanActivityRow } from './model.ts';

const payload = {
  plan_id: 'plan-7',
  total: 25,
  done: 12,
  placed: 10,
  broken: 2,
  skipped_by_code: { changed: 2, out_of_reach: 5, no_material: 0 },
  phase: 'waiting_materials',
  next_need: { block: 'minecraft:oak_planks', count: 4 },
};

describe('toPlanActivityRow', () => {
  it('keeps the agent label, the plan id, the phase and the counts', () => {
    const row = toPlanActivityRow('Ada', payload);
    expect(row).toEqual({
      agent: 'Ada',
      plan: 'plan-7',
      phase: 'waiting_materials',
      total: 25,
      done: 12,
      placed: 10,
      broken: 2,
      failures: [
        { code: 'out_of_reach', count: 5 },
        { code: 'changed', count: 2 },
      ],
    });
  });

  it('drops any key beyond the schema, such as a seen map or unseen cells', () => {
    const leaked = {
      ...payload,
      seen: { '0,64,0': 'stone' },
      unseen_cells: [{ x: 4, y: 64, z: 9 }],
    };
    const row = toPlanActivityRow('Ada', leaked);
    expect(Object.keys(row).sort()).toEqual(
      ['agent', 'broken', 'done', 'failures', 'phase', 'placed', 'plan', 'total'].sort(),
    );
    expect(JSON.stringify(row)).not.toMatch(/seen|unseen|"x"|"z"/);
  });

  it('accepts a payload with no failures', () => {
    const row = toPlanActivityRow('Ada', { ...payload, skipped_by_code: {} });
    expect(row.failures).toEqual([]);
  });

  it('throws on each malformed field instead of drawing a partial line', () => {
    expect(() => toPlanActivityRow('Ada', null)).toThrow('payload must be an object');
    expect(() => toPlanActivityRow('Ada', { ...payload, plan_id: '' })).toThrow('plan_id');
    expect(() => toPlanActivityRow('Ada', { ...payload, phase: 'exploding' })).toThrow('phase');
    expect(() => toPlanActivityRow('Ada', { ...payload, done: -1 })).toThrow('done');
    expect(() => toPlanActivityRow('Ada', { ...payload, placed: 1.5 })).toThrow('placed');
    expect(() => toPlanActivityRow('Ada', { ...payload, total: '25' })).toThrow('total');
    expect(() => toPlanActivityRow('Ada', { ...payload, skipped_by_code: [] })).toThrow(
      'skipped_by_code',
    );
    expect(() =>
      toPlanActivityRow('Ada', { ...payload, skipped_by_code: { 'Bad Code': 1 } }),
    ).toThrow('failure code');
    expect(() =>
      toPlanActivityRow('Ada', { ...payload, skipped_by_code: { changed: -3 } }),
    ).toThrow('skipped_by_code.changed');
  });
});

describe('planActivityLines', () => {
  it('writes one line per row with the label, counts and codes as plain text', () => {
    const lines = planActivityLines([toPlanActivityRow('Ada', payload)]);
    expect(lines).toEqual([
      'Ada · plan plan-7 · waiting_materials · 12/25 done · placed 10 · broken 2 ' +
        '· skipped: out_of_reach 5, changed 2',
    ]);
  });

  it('shows none when nothing was skipped', () => {
    const lines = planActivityLines([
      toPlanActivityRow('Ada', { ...payload, skipped_by_code: {} }),
    ]);
    expect(lines[0]).toMatch(/skipped: none$/);
  });
});
