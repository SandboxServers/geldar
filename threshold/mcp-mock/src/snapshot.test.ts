import { validateSnapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { makeId } from './ids.ts';
import { buildSnapshot, type SnapshotParams } from './snapshot.ts';

const base: SnapshotParams = {
  agentId: 'ag_kestrel_01',
  shard: 'dawn',
  revision: 3,
  snapshotN: 7,
  day: 2,
  ticks: 4000,
  timeOfDay: 'dusk',
  position: { x: 10, y: 64, z: -5 },
  health: 18,
  food: 15,
  inventory: [{ item: 'bread', count: 2 }],
  neighbours: [{ name: 'Wren', distance: 4.5 }],
};

describe('buildSnapshot', () => {
  it('passes validateSnapshot with a plan and without', () => {
    const without = validateSnapshot(buildSnapshot(base));
    expect(without.ok, without.ok ? '' : without.errors.join('; ')).toBe(true);
    const withPlan = validateSnapshot(
      buildSnapshot({ ...base, plan: { goal: 'gather wood', action: 'chop', status: 'running' } }),
    );
    expect(withPlan.ok, withPlan.ok ? '' : withPlan.errors.join('; ')).toBe(true);
    expect(buildSnapshot(base).current_plan).toBeUndefined();
  });

  it('keeps heard empty and notable blocks free of text', () => {
    const s = buildSnapshot(base);
    expect(s.heard).toEqual([]);
    expect(s.events_since_last_thought).toEqual([]);
    expect(s.surroundings.notable_blocks.length).toBeGreaterThan(0);
    for (const b of s.surroundings.notable_blocks) expect('text' in b).toBe(false);
  });
});

describe('makeId', () => {
  it('matches the contract patterns', () => {
    expect(makeId('sn', 1)).toMatch(/^sn_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(makeId('in', 123456789)).toMatch(/^in_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(makeId('ac', 0)).toMatch(/^ac_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(makeId('pr', 5).startsWith('pr_')).toBe(true);
    expect(makeId('bk', 33)).toBe('bk_00000011');
  });

  it('is distinct for distinct counters and rejects bad ones', () => {
    expect(makeId('sn', 1)).not.toBe(makeId('sn', 2));
    expect(makeId('sn', 1)).toBe(makeId('sn', 1));
    expect(() => makeId('sn', -1)).toThrow();
    expect(() => makeId('sn', 1.5)).toThrow();
  });
});
