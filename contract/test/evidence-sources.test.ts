import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encounterKey, validateCombatFactPayload } from '../src/evidence.ts';
import { validateObservationPayload, validateProvenance } from '../src/generated/validators.js';
import { observationSentence } from '../src/observation.ts';
import { provenanceCombatSubject, provenanceTakeSubject } from '../src/subjects.ts';

const KESTREL = { name: 'Kestrel', life: 'ag_kestrel_01' };
const MOB = '0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b';
const KEY = `enc:ag_kestrel_01:${MOB}`;
const COMBAT = {
  life_id: 'ag_kestrel_01',
  kind: 'hostile_kill',
  mob: 'zombie',
  encounter_key: KEY,
};
const FIGHT = { kind: 'fight_seen', actor: KESTREL, target: 'creeper', key: 'fgt:12:creeper' };
const TAKEN = {
  kind: 'container_taken',
  actor: KESTREL,
  item: 'bread',
  count: 3,
  key: 'tak:12:bread3',
};
const TAKE = {
  world: 'world',
  x: 1,
  y: 64,
  z: -2,
  actor: 'Kestrel',
  prior_owner: null,
  item: 'bread',
  count: 3,
  tick: 12,
};
const COMBAT_PROVENANCE = {
  world: 'world',
  actor: 'Kestrel',
  target: 'zombie',
  kind: 'killed',
  tick: 12,
};

describe('evidence sources (AN-46, decision 0345)', () => {
  it('causal observation payloads validate, with and without a visible actor', () => {
    expect(validateObservationPayload(FIGHT)).toBe(true);
    expect(validateObservationPayload({ ...FIGHT, actor: undefined })).toBe(true);
    expect(validateObservationPayload(TAKEN)).toBe(true);
    const { actor: _unused, ...unattributed } = TAKEN;
    expect(validateObservationPayload(unattributed)).toBe(true);
  });

  it('a malformed or ambiguous actor is invalid', () => {
    const bad = [
      { name: 'Kestrel' },
      { life: 'ag_kestrel_01' },
      { ...KESTREL, extra: 1 },
      { ...KESTREL, name: 'Has Space' },
      { ...KESTREL, life: 'Kestrel' },
    ];
    for (const actor of bad) {
      expect(validateObservationPayload({ ...FIGHT, actor })).toBe(false);
      expect(validateObservationPayload({ ...TAKEN, actor })).toBe(false);
    }
  });

  it('a fight or take with a target or item outside its pattern is invalid', () => {
    expect(validateObservationPayload({ ...FIGHT, target: 'Creeper' })).toBe(false);
    expect(validateObservationPayload({ ...TAKEN, count: 0 })).toBe(false);
    expect(validateObservationPayload({ ...TAKEN, count: 2305 })).toBe(false);
    expect(validateObservationPayload({ ...TAKEN, count: 2304 })).toBe(true);
  });

  it('mixed-case actor names fit the observation keys (infrastructure dedup keys)', () => {
    expect(validateObservationPayload({ ...FIGHT, key: 'fight:12:Kestrel:creeper' })).toBe(true);
    expect(validateObservationPayload({ ...TAKEN, key: 'take:12:1:64:-2:Kestrel:bread' })).toBe(
      true,
    );
  });

  it('an observation key of 128 characters is accepted and 129 is refused', () => {
    const key128 = `fight:${'a'.repeat(128 - 'fight:'.length)}`;
    expect(key128.length).toBe(128);
    expect(validateObservationPayload({ ...FIGHT, key: key128 })).toBe(true);
    expect(validateObservationPayload({ ...FIGHT, key: `${key128}a` })).toBe(false);
    const take128 = `tak:${'b'.repeat(128 - 'tak:'.length)}`;
    expect(validateObservationPayload({ ...TAKEN, key: take128 })).toBe(true);
    expect(validateObservationPayload({ ...TAKEN, key: `${take128}b` })).toBe(false);
  });

  it('a combat fact without mob is invalid', () => {
    const { mob: _unused, ...noMob } = COMBAT;
    expect(validateCombatFactPayload(noMob).ok).toBe(false);
  });

  it('a combat mob is a lowercase name: casing, namespace and length are refused', () => {
    for (const mob of ['Zombie', 'minecraft:zombie', 'a'.repeat(65), '']) {
      expect(validateCombatFactPayload({ ...COMBAT, mob }).ok).toBe(false);
    }
    expect(validateCombatFactPayload({ ...COMBAT, mob: 'a'.repeat(64) }).ok).toBe(true);
  });

  it('provenance take rejects a missing field, a bad count, an extra field and a short actor', () => {
    for (const field of ['x', 'y', 'z', 'item', 'count', 'tick', 'actor']) {
      const { [field]: _unused, ...missing } = TAKE as Record<string, unknown>;
      expect(validateProvenance(missing)).toBe(false);
    }
    expect(validateProvenance({ ...TAKE, count: 0 })).toBe(false);
    expect(validateProvenance({ ...TAKE, count: 2305 })).toBe(false);
    expect(validateProvenance({ ...TAKE, extra: 1 })).toBe(false);
    expect(validateProvenance({ ...TAKE, actor: 'ab' })).toBe(false);
  });

  it('the MCP player event type names fight_seen and container_taken', () => {
    const schema: unknown = JSON.parse(
      readFileSync(new URL('../schemas/mcp-common.schema.json', import.meta.url), 'utf8'),
    );
    const enums: unknown[][] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (Array.isArray(record.enum)) enums.push(record.enum);
        Object.values(record).forEach(walk);
      }
    };
    walk(schema);
    const withFight = enums.filter((list) => list.includes('fight_seen'));
    expect(withFight.length).toBeGreaterThan(0);
    for (const list of withFight) {
      expect(list).toContain('container_taken');
    }
  });

  it('a combat fact validates with its four keys', () => {
    expect(validateCombatFactPayload(COMBAT).ok).toBe(true);
    expect(validateCombatFactPayload({ ...COMBAT, kind: 'fight_survived' }).ok).toBe(true);
  });

  it('a combat fact without encounter_key is invalid', () => {
    const { encounter_key: _unused, ...noKey } = COMBAT;
    expect(validateCombatFactPayload(noKey).ok).toBe(false);
  });

  it('a combat fact with an uppercase mob UUID in encounter_key is invalid', () => {
    const upper = `enc:ag_kestrel_01:${MOB.toUpperCase()}`;
    expect(validateCombatFactPayload({ ...COMBAT, encounter_key: upper }).ok).toBe(false);
  });

  it('a key whose life part differs from life_id is accepted by the schema', () => {
    const other = `enc:ag_bramble_02:${MOB}`;
    expect(validateCombatFactPayload({ ...COMBAT, encounter_key: other }).ok).toBe(true);
  });

  it('a fled kind is rejected and no promise shape exists', () => {
    expect(validateCombatFactPayload({ ...COMBAT, kind: 'fled' }).ok).toBe(false);
    expect(validateObservationPayload({ kind: 'promise', key: 'prm:12:abcdefgh' })).toBe(false);
  });

  it('a combat fact carries no extra field', () => {
    expect(validateCombatFactPayload({ ...COMBAT, tick: 12 }).ok).toBe(false);
  });

  it('take and combat provenance validate, and the take has no kind', () => {
    expect(validateProvenance(TAKE)).toBe(true);
    expect(validateProvenance({ ...TAKE, kind: 'take' })).toBe(false);
    expect(validateProvenance({ ...TAKE, prior_owner: 'Bramble' })).toBe(true);
    expect(validateProvenance(COMBAT_PROVENANCE)).toBe(true);
    expect(validateProvenance({ ...COMBAT_PROVENANCE, kind: 'fled' })).toBe(false);
  });

  it('the provenance subjects have four tokens', () => {
    expect(provenanceTakeSubject('main')).toBe('geldar.main.provenance.take');
    expect(provenanceCombatSubject('main')).toBe('geldar.main.provenance.combat');
    expect(() => provenanceTakeSubject('bad shard')).toThrow();
    expect(() => provenanceCombatSubject('bad shard')).toThrow();
  });
});

describe('the combat key (decision 0321)', () => {
  it('gives the lowercase key for an uppercase UUID', () => {
    expect(encounterKey('ag_kestrel_01', 'ABCDEF01-2345-6789-ABCD-EF0123456789')).toBe(
      'enc:ag_kestrel_01:abcdef01-2345-6789-abcd-ef0123456789',
    );
  });

  it('round-trips the life and the UUID of the matching pair', () => {
    const key = encounterKey('ag_kestrel_01', MOB) ?? '';
    expect(key).toBe(KEY);
    const [prefix, life, uuid] = key.split(':');
    expect(prefix).toBe('enc');
    expect(life).toBe('ag_kestrel_01');
    expect(uuid).toBe(MOB);
    expect(validateCombatFactPayload({ ...COMBAT, encounter_key: key }).ok).toBe(true);
  });

  it('a non-UUID mob gives null', () => {
    expect(encounterKey('ag_kestrel_01', 'not-a-uuid')).toBeNull();
    expect(encounterKey('ag_kestrel_01', '')).toBeNull();
  });

  it('a life id that is not a LifeId gives null', () => {
    expect(encounterKey('Kestrel', MOB)).toBeNull();
    expect(encounterKey('ag_kestrel_1', MOB)).toBeNull();
  });

  it('a non-string mob id is refused with a clear error, not coerced', () => {
    expect(() => encounterKey('ag_kestrel_01', {} as never)).toThrow(TypeError);
    expect(() => encounterKey('ag_kestrel_01', {} as never)).toThrow(/must be strings/);
    expect(() => encounterKey('ag_kestrel_01', null as never)).toThrow(TypeError);
  });

  it('a non-string life id is refused with a clear error', () => {
    expect(() => encounterKey(undefined as never, MOB)).toThrow(TypeError);
  });
});

describe('the two draft sentences (AN-46, OWNER APPROVAL REQUIRED)', () => {
  it('a fight gives the draft sentence with the mob name through the pattern', () => {
    expect(observationSentence({ kind: 'fight_seen', target: 'creeper' })).toBe(
      'Someone fought a creeper nearby.',
    );
  });

  it('the fight sentence picks a or an by the first letter of the mob name', () => {
    expect(observationSentence({ kind: 'fight_seen', target: 'iron_golem' })).toBe(
      'Someone fought an iron golem nearby.',
    );
    expect(observationSentence({ kind: 'fight_seen', target: 'evoker' })).toBe(
      'Someone fought an evoker nearby.',
    );
    expect(observationSentence({ kind: 'fight_seen', target: 'creeper' })).toBe(
      'Someone fought a creeper nearby.',
    );
  });

  it('a take gives the draft sentence with the item and count', () => {
    expect(observationSentence({ kind: 'container_taken', item: 'bread', count: 3 })).toBe(
      'Someone took 3 bread from your container.',
    );
  });

  it('a marker word in a fight or take falls back to the generic sentence', () => {
    expect(observationSentence({ kind: 'fight_seen', target: 'observer' })).toBe(
      'Something happened.',
    );
    expect(observationSentence({ kind: 'container_taken', item: 'white_harness', count: 1 })).toBe(
      'Something happened.',
    );
  });
});
