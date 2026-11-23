import { describe, expect, it } from 'vitest';
import { pickAgent } from '../src/args.ts';

describe('pickAgent (one-agent wall by default)', () => {
  it('watches the agent asked for, listed or not', () => {
    expect(pickAgent('ag_b', [{ id: 'ag_a' }, { id: 'ag_b' }])).toBe('ag_b');
    expect(pickAgent('ag_z', [{ id: 'ag_a' }])).toBe('ag_z');
  });

  it('with no --agent, watches the first agent the page lists', () => {
    expect(pickAgent(null, [{ id: 'ag_a' }, { id: 'ag_b' }])).toBe('ag_a');
  });

  it('is null when nothing is listed or the first entry has no string id', () => {
    expect(pickAgent(null, [])).toBeNull();
    expect(pickAgent(null, [{ id: 7 }, { id: 'ag_b' }])).toBeNull();
    expect(pickAgent(null, [{}])).toBeNull();
  });
});
