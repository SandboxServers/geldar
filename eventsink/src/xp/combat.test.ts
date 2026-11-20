import { validateWorldEvent, type WorldEvent } from '@geldar/contract';
import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import type { Award, XpAward } from './awards.ts';
import { awardsFor } from './awards.ts';
import { combatFactAwards, killKey } from './combat.ts';
import { XP_FIXTURES } from './fixtures.ts';
import { applyAward, type XpStore } from './ledger.ts';

const LIFE = 'ag_kestrel_01';
const MOB = '0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b';
const KEY = `enc:${LIFE}:${MOB}`;

function fixture(name: string): WorldEvent {
  const event = XP_FIXTURES[name];
  if (!event) throw new Error(`no fixture ${name}`);
  return event;
}

/** The award function awardsOf builds, for a combat_fact at tick 48500. */
const factAward: Award = (domain, evidenceKey) => [
  { lifeId: LIFE, domain, evidenceKey, sourceEventId: 'ev_fact', worldTick: 48500 },
];

function factPayload(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    life_id: LIFE,
    kind: 'hostile_kill',
    mob: 'zombie',
    encounter_key: KEY,
    ...change,
  };
}

/** An in-memory XpStore with the SQL's keys: evidence by (life, domain, key), xp by (life, domain). */
function memoryStore() {
  const evidence = new Set<string>();
  const xp = new Map<string, number>();
  const store: XpStore = {
    async lifeExists() {
      return true;
    },
    async insertEvidence(a: XpAward) {
      const key = `${a.lifeId}|${a.domain}|${a.evidenceKey}`;
      if (evidence.has(key)) return false;
      evidence.add(key);
      return true;
    },
    async bump(life, domain) {
      const key = `${life}|${domain}`;
      const next = (xp.get(key) ?? 0) + 1;
      xp.set(key, next);
      return { xp: next, level: 0 };
    },
    async setLevel() {},
    async totalXp() {
      return 0;
    },
    async enqueueLevel() {},
  };
  return { store, evidence, xp };
}

describe('killKey', () => {
  it('gives the lowercase encounter key of an uppercase target_uuid', () => {
    expect(killKey(LIFE, { target_uuid: MOB.toUpperCase() })).toBe(KEY);
  });

  it('gives null for a target_uuid that is not a UUID, or none at all', () => {
    expect(killKey(LIFE, { target_uuid: 'zombie' })).toBeNull();
    expect(killKey(LIFE, { target_uuid: 42 })).toBeNull();
    expect(killKey(LIFE, {})).toBeNull();
  });
});

describe('combatFactAwards', () => {
  it('awards exactly the encounter key of the combat_fact_kill payload, in the combat domain', () => {
    const payload = fixture('combat_fact_kill').payload as Record<string, unknown>;
    expect(combatFactAwards(payload, factAward)).toEqual([
      expect.objectContaining({ domain: 'combat', evidenceKey: KEY, lifeId: LIFE }),
    ]);
  });

  it('accepts the optional player key and awards the same one key without it', () => {
    expect(combatFactAwards(factPayload({ player: 'Kestrel' }), factAward)).toHaveLength(1);
    expect(combatFactAwards(factPayload(), factAward).map((a) => a.evidenceKey)).toEqual([KEY]);
  });

  it('awards a fight_survived of the same encounter the same key', () => {
    const survived = factPayload({ kind: 'fight_survived' });
    expect(combatFactAwards(survived, factAward).map((a) => a.evidenceKey)).toEqual([KEY]);
  });

  it("gives [] for another life's key, even a valid one", () => {
    const other = `enc:ag_other_02:${MOB}`;
    expect(combatFactAwards(factPayload({ encounter_key: other }), factAward)).toEqual([]);
  });

  it('gives [] for a key that is not the life and UUID form, or an unknown kind, mob or key', () => {
    expect(
      combatFactAwards(factPayload({ encounter_key: `enc:${LIFE}:zombie` }), factAward),
    ).toEqual([]);
    expect(combatFactAwards(factPayload({ kind: 'mob_died' }), factAward)).toEqual([]);
    expect(combatFactAwards(factPayload({ mob: 7 }), factAward)).toEqual([]);
    expect(combatFactAwards(factPayload({ encounter_key: undefined }), factAward)).toEqual([]);
  });
});

describe('the attack row and the combat fact share one key (AN-47b)', () => {
  it('the hand-built fixtures pass validateWorldEvent', () => {
    expect(validateWorldEvent(fixture('kill_uuid_completed')).ok).toBe(true);
    expect(validateWorldEvent(fixture('combat_fact_kill')).ok).toBe(true);
  });

  it('no awards row registers combat_fact yet (AN-50a owns the case arm)', () => {
    expect(awardsFor(fixture('combat_fact_kill'))).toEqual([]);
  });

  it.each([
    ['kill first', 'kill'],
    ['fact first', 'fact'],
  ])('one fight, one row: %s pays the combat domain once', async (_label, first) => {
    const kill = awardsFor(fixture('kill_uuid_completed'));
    const fact = combatFactAwards(
      fixture('combat_fact_kill').payload as Record<string, unknown>,
      factAward,
    );
    const awards = first === 'kill' ? [...kill, ...fact] : [...fact, ...kill];
    const { store, evidence, xp } = memoryStore();
    const results: boolean[] = [];
    for (const award of awards) {
      results.push((await applyAward(store, award, DEFAULT_THRESHOLDS)).awarded);
    }
    expect(results).toEqual([true, false]);
    expect(evidence.size).toBe(1);
    expect(xp.get(`${LIFE}|combat`)).toBe(1);
  });
});
