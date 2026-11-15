import { describe, expect, it } from 'vitest';
import { alignmentLabel, type Score } from '../src/index.ts';

describe('alignmentLabel', () => {
  it('gives all nine cells: law (L, T, C) then good (G, N, E)', () => {
    expect(alignmentLabel(5, 5)).toBe('LG');
    expect(alignmentLabel(5, 3)).toBe('LN');
    expect(alignmentLabel(5, 1)).toBe('LE');
    expect(alignmentLabel(3, 5)).toBe('TG');
    expect(alignmentLabel(3, 3)).toBe('TN');
    expect(alignmentLabel(3, 1)).toBe('TE');
    expect(alignmentLabel(1, 5)).toBe('CG');
    expect(alignmentLabel(1, 3)).toBe('CN');
    expect(alignmentLabel(1, 1)).toBe('CE');
  });

  it('puts the boundary scores on the right side: 4 is high, 2 is low, 3 is the middle', () => {
    expect(alignmentLabel(4, 4)).toBe('LG');
    expect(alignmentLabel(2, 2)).toBe('CE');
    expect(alignmentLabel(4, 2)).toBe('LE');
    expect(alignmentLabel(2, 4)).toBe('CG');
    expect(alignmentLabel(4, 3)).toBe('LN');
    expect(alignmentLabel(3, 4)).toBe('TG');
  });

  it('covers every score pair with a two-letter label from the table', () => {
    const scores: Score[] = [1, 2, 3, 4, 5];
    const labels = new Set<string>();
    for (const law of scores) {
      for (const good of scores) labels.add(alignmentLabel(law, good));
    }
    expect([...labels].sort()).toEqual(['CE', 'CG', 'CN', 'LE', 'LG', 'LN', 'TE', 'TG', 'TN']);
  });
});
