import { describe, expect, it } from 'vitest';
import { validateCharacterSheet, validateSheetAdoptedPayload } from '../src/index.ts';

const sheet = () => ({
  version: 1,
  attributes: { curiosity: 3, common_sense: 4, cleverness: 2, aggression: 5 },
  alignment: { law: 3, good: 4 },
  op_modes: {
    explorer: 3,
    farmer: 2,
    miner: 4,
    builder: 1,
    crafter: 3,
    warrior: 5,
    nitwit: 2,
  },
});

/** The thirteen innate scores, as paths into a sheet. */
const SCORE_PATHS: [string, string][] = [
  ['attributes', 'curiosity'],
  ['attributes', 'common_sense'],
  ['attributes', 'cleverness'],
  ['attributes', 'aggression'],
  ['alignment', 'law'],
  ['alignment', 'good'],
  ['op_modes', 'explorer'],
  ['op_modes', 'farmer'],
  ['op_modes', 'miner'],
  ['op_modes', 'builder'],
  ['op_modes', 'crafter'],
  ['op_modes', 'warrior'],
  ['op_modes', 'nitwit'],
];

function withScore(group: string, key: string, value: unknown): Record<string, unknown> {
  const copy = sheet() as unknown as Record<string, Record<string, unknown>>;
  copy[group]![key] = value;
  return copy;
}

describe('character sheet', () => {
  it('accepts a standard sheet', () => {
    expect(validateCharacterSheet(sheet()).ok).toBe(true);
  });

  it.each([1, 5])('accepts the bounds: every score at %i', (bound) => {
    const value = sheet() as unknown as Record<string, Record<string, unknown>>;
    for (const [group, key] of SCORE_PATHS) value[group]![key] = bound;
    expect(validateCharacterSheet(value).ok).toBe(true);
  });

  it.each(SCORE_PATHS)('refuses %s.%s at 0, 6 and 3.5', (group, key) => {
    for (const bad of [0, 6, 3.5]) {
      expect(validateCharacterSheet(withScore(group, key, bad)).ok).toBe(false);
    }
  });

  it.each(SCORE_PATHS)('refuses an unknown key under %s.%s level', (group) => {
    const value = sheet() as unknown as Record<string, Record<string, unknown>>;
    value[group]!.extra = 3;
    expect(validateCharacterSheet(value).ok).toBe(false);
  });

  it('refuses an unknown top-level key', () => {
    expect(validateCharacterSheet({ ...sheet(), extra: 1 }).ok).toBe(false);
  });

  it('refuses a sheet that carries proficiency', () => {
    const result = validateCharacterSheet({ ...sheet(), proficiency: { combat: 0 } });
    expect(result.ok).toBe(false);
  });

  it('refuses a version other than 1', () => {
    expect(validateCharacterSheet({ ...sheet(), version: 2 }).ok).toBe(false);
  });

  it('refuses a sheet with a missing group', () => {
    const { op_modes: _omitted, ...rest } = sheet();
    expect(validateCharacterSheet(rest).ok).toBe(false);
  });
});

describe('sheet-adopted payload', () => {
  const hash = 'a'.repeat(64);
  const adopted = (overrides: Record<string, unknown> = {}) => ({
    life_id: 'ag_kestrel_01',
    sheet: sheet(),
    sheet_hash: hash,
    source: 'config',
    ...overrides,
  });

  it('accepts an adoption from each source', () => {
    for (const source of ['config', 'roster', 'birth', 'conversion']) {
      expect(validateSheetAdoptedPayload(adopted({ source })).ok).toBe(true);
    }
  });

  it('refuses a hash that is not 64 lower-case hex characters', () => {
    expect(validateSheetAdoptedPayload(adopted({ sheet_hash: 'A'.repeat(64) })).ok).toBe(false);
    expect(validateSheetAdoptedPayload(adopted({ sheet_hash: 'a'.repeat(63) })).ok).toBe(false);
  });

  it('refuses an unknown source', () => {
    expect(validateSheetAdoptedPayload(adopted({ source: 'manual' })).ok).toBe(false);
  });

  it('refuses a near-miss source spelling, so only the four listed values pass', () => {
    for (const source of ['conversions', 'CONVERSION', 'converted']) {
      expect(validateSheetAdoptedPayload(adopted({ source })).ok).toBe(false);
    }
  });

  it('refuses an embedded sheet that carries proficiency', () => {
    const bad = adopted({ sheet: { ...sheet(), proficiency: { combat: 0 } } });
    expect(validateSheetAdoptedPayload(bad).ok).toBe(false);
  });
});
