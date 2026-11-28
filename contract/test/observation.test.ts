import { describe, expect, it } from 'vitest';
import { markedWords } from '../src/agent-text.ts';
import { validateHurtPayload } from '../src/generated/validators.js';
import {
  observationSentence,
  provenanceBreakSubject,
  provenancePickupSubject,
  provenanceWildcard,
  validateObservationPayload,
  validateProvenance,
} from '../src/index.ts';

const KESTREL = { name: 'Kestrel', life: 'ag_kestrel_01' };
const GIFT = { kind: 'gift_received', item: 'bread', count: 3, key: 'gift:12:none:bread:3:0' };
const BROKEN = { kind: 'property_broken', block: 'chest', key: 'brk:12:1:2:3:none' };
const BREAK = {
  kind: 'break',
  world: 'world',
  x: 1,
  y: 64,
  z: -2,
  actor: 'Kestrel',
  prior_owner: 'Bramble',
  block: 'chest',
  tick: 12,
};
const PICKUP = {
  kind: 'pickup',
  world: 'world',
  picker: 'Kestrel',
  thrower: null,
  item: 'bread',
  count: 1,
  age_ticks: 4,
  distance: null,
  tick: 12,
};

describe('observed-actor contract (AN-24, decision 0343)', () => {
  it('an attributed and an unattributed gift validate', () => {
    expect(validateObservationPayload({ ...GIFT, actor: KESTREL })).toBe(true);
    expect(validateObservationPayload(GIFT)).toBe(true);
  });

  it('a hurt payload with and without actor validates', () => {
    const hurt = { type: 'hurt', source: 'melee', amount: 2 };
    expect(validateHurtPayload(hurt)).toBe(true);
    expect(validateHurtPayload({ ...hurt, actor: KESTREL })).toBe(true);
  });

  it('a name with a space, a dot or 17 characters fails', () => {
    for (const name of ['Has Space', 'a.b.c', 'abcdefghijklmnopq']) {
      expect(validateObservationPayload({ ...GIFT, actor: { ...KESTREL, name } })).toBe(false);
    }
  });

  it('a life that is not a LifeId fails', () => {
    expect(validateObservationPayload({ ...GIFT, actor: { ...KESTREL, life: 'kestrel_01' } })).toBe(
      false,
    );
  });

  it('an observation is not a Provenance and a Provenance is not an observation', () => {
    expect(validateProvenance(GIFT)).toBe(false);
    expect(validateProvenance(BROKEN)).toBe(false);
    expect(validateObservationPayload(BREAK)).toBe(false);
    expect(validateObservationPayload(PICKUP)).toBe(false);
  });

  it('observationSentence never contains a name and passes markedWords for every kind', () => {
    for (const kind of ['gift_received', 'property_broken', 'other']) {
      for (const item of ['bread', 'iron_ingot', 'bow']) {
        for (const count of [1, 3, 2304]) {
          for (const block of ['chest', 'oak_door']) {
            const input = { kind, item, count, block, actor: KESTREL };
            const sentence = observationSentence(input);
            expect(sentence).not.toContain('Kestrel');
            expect(markedWords(sentence)).toEqual([]);
          }
        }
      }
    }
    expect(observationSentence({ kind: 'gift_received', item: 'bread', count: 3 })).toBe(
      'You received 3 bread.',
    );
    expect(observationSentence({ kind: 'property_broken', block: 'oak_door' })).toBe(
      'Someone broke your oak door.',
    );
    expect(observationSentence({ kind: 'other' })).toBe('Something happened.');
  });

  it('an actor with basis seen, spoke or signed validates; basis heard fails', () => {
    for (const basis of ['seen', 'spoke', 'signed']) {
      expect(validateObservationPayload({ ...GIFT, actor: { ...KESTREL, basis } })).toBe(true);
    }
    expect(validateObservationPayload({ ...GIFT, actor: { ...KESTREL, basis: 'heard' } })).toBe(
      false,
    );
  });

  it('names the actor in every kind when basis is present', () => {
    const named = { ...KESTREL, basis: 'seen' };
    expect(observationSentence({ kind: 'property_broken', block: 'chest', actor: named })).toBe(
      'Kestrel broke your chest.',
    );
    expect(
      observationSentence({ kind: 'container_taken', item: 'bread', count: 3, actor: named }),
    ).toBe('Kestrel took 3 bread from your container.');
    expect(observationSentence({ kind: 'fight_seen', target: 'zombie', actor: named })).toBe(
      'Kestrel fought a zombie nearby.',
    );
    for (const basis of ['spoke', 'signed']) {
      expect(
        observationSentence({
          kind: 'property_broken',
          block: 'chest',
          actor: { ...KESTREL, basis },
        }),
      ).toBe('Kestrel broke your chest.');
    }
  });

  it('says Someone in every kind when basis is absent or not a basis', () => {
    expect(observationSentence({ kind: 'property_broken', block: 'chest', actor: KESTREL })).toBe(
      'Someone broke your chest.',
    );
    expect(
      observationSentence({
        kind: 'container_taken',
        item: 'bread',
        count: 3,
        actor: { ...KESTREL, basis: 'heard' },
      }),
    ).toBe('Someone took 3 bread from your container.');
    expect(observationSentence({ kind: 'fight_seen', target: 'zombie', actor: KESTREL })).toBe(
      'Someone fought a zombie nearby.',
    );
  });

  it('a marker-named actor gives the Someone form even with basis', () => {
    for (const name of ['Observer1', 'Streamer']) {
      const actor = { name, life: 'ag_kestrel_01', basis: 'seen' };
      expect(observationSentence({ kind: 'property_broken', block: 'chest', actor })).toBe(
        'Someone broke your chest.',
      );
    }
  });

  it('a named sentence shows no life id, UUID or digit beyond the count', () => {
    const actor = { ...KESTREL, basis: 'seen' };
    for (const sentence of [
      observationSentence({ kind: 'property_broken', block: 'chest', actor }),
      observationSentence({ kind: 'container_taken', item: 'bread', count: 3, actor }),
      observationSentence({ kind: 'fight_seen', target: 'zombie', actor }),
    ]) {
      expect(sentence).not.toMatch(/ag_|[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(sentence.replace(/[^0-9]/g, '')).toMatch(/^(3)?$/);
    }
  });

  it('a marker word in an item or block gives the generic sentence', () => {
    expect(observationSentence({ kind: 'gift_received', item: 'amethyst_shard', count: 1 })).toBe(
      'Something happened.',
    );
    expect(observationSentence({ kind: 'gift_received', item: 'white_harness', count: 1 })).toBe(
      'Something happened.',
    );
    expect(observationSentence({ kind: 'property_broken', block: 'observer' })).toBe(
      'Something happened.',
    );
    expect(
      observationSentence({ kind: 'gift_received', item: 'happy_ghast_harness', count: 1 }),
    ).toBe('You received 1 happy ghast harness.');
  });

  it('a property key that is empty or outside 8 to 96 characters fails', () => {
    for (const key of ['', 'short', 'x'.repeat(97)]) {
      expect(validateObservationPayload({ ...BROKEN, key })).toBe(false);
    }
    expect(validateObservationPayload(BROKEN)).toBe(true);
  });

  it('subject helpers reject a dot or a wildcard in the shard', () => {
    for (const shard of ['bad.shard', '*', '>']) {
      expect(() => provenanceBreakSubject(shard)).toThrow();
      expect(() => provenancePickupSubject(shard)).toThrow();
      expect(() => provenanceWildcard(shard)).toThrow();
    }
  });

  it('provenance subjects have four tokens', () => {
    expect(provenanceBreakSubject('main')).toBe('geldar.main.provenance.break');
    expect(provenancePickupSubject('main')).toBe('geldar.main.provenance.pickup');
    expect(provenanceWildcard('main')).toBe('geldar.main.provenance.>');
    for (const subject of [
      provenanceBreakSubject('main'),
      provenancePickupSubject('main'),
      provenanceWildcard('main'),
    ]) {
      expect(subject.split('.')).toHaveLength(4);
    }
  });
});
