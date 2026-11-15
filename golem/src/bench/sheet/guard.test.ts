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

  it('accepts a scratch- name that spells a live word, because the prefix is the guard', () => {
    expect(checkScratch('scratch-geldar', 'scratch-geldar').ok).toBe(true);
  });

  it('refuses a bare live name, which has no scratch- prefix', () => {
    expect(checkScratch('geldar', 'geldar').ok).toBe(false);
    expect(checkScratch('geldar-colo', 'geldar-colo').ok).toBe(false);
  });

  it('refuses an empty or unsafe name', () => {
    expect(checkScratch('', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-a/../b', 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-X', 'scratch-x').ok).toBe(false);
  });

  it('accepts a whole name of 32 characters and refuses 33, for the shard and the project', () => {
    const at32 = `scratch-${'a'.repeat(24)}`;
    const at33 = `scratch-${'a'.repeat(25)}`;
    expect(at32.length).toBe(32);
    expect(at33.length).toBe(33);
    expect(checkScratch(at32, at32).ok).toBe(true);
    expect(checkScratch(at33, 'scratch-x').ok).toBe(false);
    expect(checkScratch('scratch-x', at33).ok).toBe(false);
  });
});
