import { describe, expect, it } from 'vitest';
import {
  validateChunkVisitedPayload,
  validateProficiencyLevelPayload,
  validateProficiencyRequest,
  validateProficiencyState,
} from '../src/index.ts';

const DOMAINS = ['combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social'];

/** A state with every domain at level 0 and no XP: what a life with no rows answers. */
const zero = () => ({
  life_id: 'ag_kestrel_01',
  version: 0,
  levels: Object.fromEntries(DOMAINS.map((d) => [d, { level: 0, xp: 0 }])),
});

/** Some XP in two domains: version is the total of the XP. */
const mid = () => ({
  ...zero(),
  version: 52,
  levels: { ...zero().levels, combat: { level: 2, xp: 40 }, mining: { level: 1, xp: 12 } },
});

/** Every domain at level 3, with large XP. */
const max = () => ({
  ...zero(),
  version: 7 * 900,
  levels: Object.fromEntries(DOMAINS.map((d) => [d, { level: 3, xp: 900 }])),
});

/** A state object with one domain removed from `levels`. */
const without = (domain: string) => {
  const state = zero();
  const levels: Record<string, unknown> = { ...state.levels };
  delete levels[domain];
  return { ...state, levels };
};

describe('proficiency state', () => {
  it('accepts the zero, mid and max fixtures', () => {
    expect(validateProficiencyState(zero()).ok).toBe(true);
    expect(validateProficiencyState(mid()).ok).toBe(true);
    expect(validateProficiencyState(max()).ok).toBe(true);
  });

  it('accepts a state that carries the adopted sheet and its hash', () => {
    const sheet = {
      version: 1,
      attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
      alignment: { law: 3, good: 3 },
      op_modes: {
        explorer: 3,
        farmer: 3,
        miner: 3,
        builder: 3,
        crafter: 3,
        warrior: 3,
        nitwit: 3,
      },
    };
    const withSheet = { ...mid(), sheet, sheet_hash: 'a'.repeat(64) };
    expect(validateProficiencyState(withSheet).ok).toBe(true);
  });

  it('refuses a level of 4', () => {
    const bad = mid();
    bad.levels.combat = { level: 4, xp: 40 };
    expect(validateProficiencyState(bad).ok).toBe(false);
  });

  it('refuses a missing domain', () => {
    for (const domain of DOMAINS) {
      expect(validateProficiencyState(without(domain)).ok, domain).toBe(false);
    }
  });

  it('refuses a negative xp', () => {
    const bad = mid();
    bad.levels.mining = { level: 1, xp: -1 };
    expect(validateProficiencyState(bad).ok).toBe(false);
  });

  it('refuses a negative version and a negative level', () => {
    expect(validateProficiencyState({ ...mid(), version: -1 }).ok).toBe(false);
    const bad = mid();
    bad.levels.combat = { level: -1, xp: 0 };
    expect(validateProficiencyState(bad).ok).toBe(false);
  });

  it('refuses an unknown domain and a sheet hash that is not 64 lower-case hex', () => {
    const extra = { ...mid(), levels: { ...mid().levels, fishing: { level: 0, xp: 0 } } };
    expect(validateProficiencyState(extra).ok).toBe(false);
    expect(validateProficiencyState({ ...mid(), sheet_hash: 'A'.repeat(64) }).ok).toBe(false);
    expect(validateProficiencyState({ ...mid(), sheet_hash: 'a'.repeat(63) }).ok).toBe(false);
  });
});

describe('proficiency request', () => {
  it('accepts a request with and without have_version', () => {
    expect(validateProficiencyRequest({ life_id: 'ag_kestrel_01' }).ok).toBe(true);
    expect(validateProficiencyRequest({ life_id: 'ag_kestrel_01', have_version: 0 }).ok).toBe(true);
  });

  it('treats an empty object as invalid and pins life_id as the only required key', () => {
    expect(validateProficiencyRequest({}).ok).toBe(false);
    expect(validateProficiencyRequest({ life_id: 'ag_kestrel_01' }).ok).toBe(true);
  });

  it('refuses a negative have_version and an unknown key', () => {
    expect(validateProficiencyRequest({ life_id: 'ag_kestrel_01', have_version: -1 }).ok).toBe(
      false,
    );
    expect(validateProficiencyRequest({ life_id: 'ag_kestrel_01', shard: 'main' }).ok).toBe(false);
  });
});

describe('proficiency level push', () => {
  const push = (level: number) => ({
    life_id: 'ag_kestrel_01',
    domain: 'mining',
    level,
    xp: 40,
    version: 52,
  });

  it('accepts levels 1 to 3 and refuses 0 and 4', () => {
    expect(validateProficiencyLevelPayload(push(1)).ok).toBe(true);
    expect(validateProficiencyLevelPayload(push(3)).ok).toBe(true);
    expect(validateProficiencyLevelPayload(push(0)).ok).toBe(false);
    expect(validateProficiencyLevelPayload(push(4)).ok).toBe(false);
  });

  it('refuses a domain outside the seven', () => {
    expect(validateProficiencyLevelPayload({ ...push(1), domain: 'fishing' }).ok).toBe(false);
  });

  it('refuses a negative version', () => {
    expect(validateProficiencyLevelPayload({ ...push(1), version: -1 }).ok).toBe(false);
  });
});

describe('chunk visited payload', () => {
  const chunk = () => ({
    life_id: 'ag_kestrel_01',
    dimension: 'overworld',
    cx: -12,
    cz: 40,
    tick: 1200,
  });

  it('accepts a chunk index, negative included', () => {
    expect(validateChunkVisitedPayload(chunk()).ok).toBe(true);
  });

  it('refuses a coordinate out of range and an upper-case dimension', () => {
    expect(validateChunkVisitedPayload({ ...chunk(), cx: 2000001 }).ok).toBe(false);
    expect(validateChunkVisitedPayload({ ...chunk(), cz: -2000001 }).ok).toBe(false);
    expect(validateChunkVisitedPayload({ ...chunk(), dimension: 'Overworld' }).ok).toBe(false);
  });

  it('accepts the coordinate bounds at exactly plus and minus 2000000', () => {
    expect(validateChunkVisitedPayload({ ...chunk(), cx: 2000000, cz: -2000000 }).ok).toBe(true);
  });

  it('accepts a 64-character dimension and refuses 65 characters', () => {
    expect(validateChunkVisitedPayload({ ...chunk(), dimension: 'a'.repeat(64) }).ok).toBe(true);
    expect(validateChunkVisitedPayload({ ...chunk(), dimension: 'a'.repeat(65) }).ok).toBe(false);
  });
});
