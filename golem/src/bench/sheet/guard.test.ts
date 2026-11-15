import { describe, expect, it } from 'vitest';
import { checkScratch } from './guard.ts';

describe('checkScratch', () => {
  it('accepts a scratch shard and a scratch project', () => {
    expect(checkScratch('scratch-sheet0', 'scratch-sheet0').ok).toBe(true);
  });

  it('refuses a shard or project without the scratch- prefix', () => {
    expect(checkScratch('sheet0', 'scratch-sheet0').ok).toBe(false);
    expect(checkScratch('scratch-sheet0', 'sheet0').ok).toBe(false);
    expect(checkScratch('phase0', 'scratch-phase0').ok).toBe(false);
  });

  it('refuses the live names even when they are otherwise well formed', () => {
    expect(checkScratch('scratch-geldar', 'scratch-geldar').ok).toBe(true);
    expect(checkScratch('geldar', 'geldar').ok).toBe(false);
  });

  it('refuses an empty or unsafe name', () => {
    expect(checkScratch('', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-a/../b', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-X', 'scratch-x').ok).toBe(false);
  });
});
