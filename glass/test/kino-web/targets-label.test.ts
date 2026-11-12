import { describe, expect, it } from 'vitest';
import { labelFor, parseTargets } from '../../web/kino/targets.ts';

describe('targets labels', () => {
  it('parses {id, label}, falls back to the id, and keeps the id for routing', () => {
    const t = parseTargets({
      enabled: true,
      signed_in: true,
      agents: [{ id: 'ag_test_01', label: 'TestRanger' }, { id: 'ag_test_02' }, { id: 'Bad Id' }],
    });
    expect(t.agents).toEqual([
      { id: 'ag_test_01', label: 'TestRanger' },
      { id: 'ag_test_02', label: 'ag_test_02' },
    ]);
    expect(labelFor('ag_test_01', t.agents)).toBe('TestRanger');
    expect(labelFor('ag_other', t.agents)).toBe('ag_other');
  });
});
