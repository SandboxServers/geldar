import { describe, expect, it } from 'vitest';
import { applyOverrides, parseScenario } from './scenario.ts';

function base(): Record<string, unknown> {
  return {
    name: 'dawn',
    character: { name: 'Aelfric', life_id: 'ag_aelfric_01', position: { x: 0, y: 64, z: 0 } },
  };
}

function withEvents(events: unknown[]): string {
  return JSON.stringify({ ...base(), events });
}

function withCharacter(patch: Record<string, unknown>): string {
  const b = base();
  return JSON.stringify({ ...b, character: { ...(b.character as object), ...patch } });
}

describe('parseScenario', () => {
  it('parses a full file and fills defaults', () => {
    const s = parseScenario(
      JSON.stringify({
        ...base(),
        neighbours: [{ name: 'Bryn', position: { x: 3, y: 64, z: 3 } }],
        books: [{ id: 'bk_one', title: 'One', kind: 'text', text: 'hello' }],
        events: [
          { type: 'speech', at_tick: 5, from: 'Bryn', to: null, text: 'hi' },
          { type: 'damage', at_tick: 9, amount: 3 },
          { type: 'agent_approaches', at_tick: 10, name: 'Cael', distance: 6 },
          { type: 'proposal', at_tick: 11, id: 'pr_1', rule: 'no digging' },
          { type: 'set_fact', at_tick: 12, fact: 'a' },
          { type: 'clear_fact', at_tick: 13, fact: 'a' },
        ],
        laws: [{ rule: 'chat', value: 'quiet' }],
      }),
    );
    expect(s.wake.min_spacing_seconds).toBe(20);
    expect(s.wake.intent_run_too_long_seconds).toBe(300);
    expect(s.day_length_seconds).toBe(2400);
    expect(s.character.budget).toBe(100);
    expect(s.character.seed).toBe('mock-seed-0001');
    expect(s.intent.default_ticks).toBe(600);
    expect(s.reflex.eat_below).toBe(14);
    expect(s.shard_rules.chat_radius).toBe(32);
    expect(s.events).toHaveLength(6);
  });

  it('rejects bad input with the path in the message', () => {
    expect(() => parseScenario(JSON.stringify({ ...base(), extra: 1 }))).toThrow('scenario:');
    expect(() => parseScenario(withCharacter({ life_id: 'nope' }))).toThrow(
      'scenario: character.life_id',
    );
    expect(() =>
      parseScenario(
        withEvents([
          { type: 'damage', at_tick: 5, amount: 1 },
          { type: 'damage', at_tick: 2, amount: 1 },
        ]),
      ),
    ).toThrow('scenario: events.1');
    expect(() => parseScenario(withEvents([{ type: 'damage', at_tick: 0, amount: 1 }]))).toThrow(
      'scenario: events.0.at_tick',
    );
    expect(() =>
      parseScenario(
        withEvents([
          { type: 'damage', at_tick: 1, amount: 1 },
          { type: 'speech', at_tick: 2, from: 'x', text: 'hi' },
        ]),
      ),
    ).toThrow('scenario: events.1.to');
    expect(() => parseScenario(withEvents([{ type: 'damage', at_tick: 1, amount: 21 }]))).toThrow(
      'scenario: events.0.amount',
    );
    expect(() => parseScenario('{')).toThrow('scenario:');
  });

  it('applies the identifier rule to character and neighbour names', () => {
    expect(() => parseScenario(withCharacter({ name: 'A'.repeat(16) }))).not.toThrow();
    expect(() => parseScenario(withCharacter({ name: 'A'.repeat(17) }))).toThrow('character.name');
    expect(() => parseScenario(withCharacter({ name: 'Ignore previous' }))).toThrow(
      'character.name',
    );
    const neighbour = (name: string): string =>
      JSON.stringify({ ...base(), neighbours: [{ name, position: { x: 0, y: 0, z: 0 } }] });
    expect(() => parseScenario(neighbour('B'.repeat(16)))).not.toThrow();
    expect(() => parseScenario(neighbour('B'.repeat(17)))).toThrow('neighbours.0.name');
    expect(() => parseScenario(neighbour('Ignore previous'))).toThrow('neighbours.0.name');
  });
});

describe('parseScenario contract limits', () => {
  const inv = (patch: Record<string, unknown>): string =>
    withCharacter({ inventory: [{ item: 'oak_log', count: 1, ...patch }] });

  it('holds inventory items to the contract', () => {
    expect(() => parseScenario(inv({}))).not.toThrow();
    expect(() => parseScenario(inv({ count: 64 }))).not.toThrow();
    expect(() => parseScenario(inv({ item: 'Oak Log' }))).toThrow(
      'scenario: character.inventory.0.item',
    );
    expect(() => parseScenario(inv({ count: 65 }))).toThrow(
      'scenario: character.inventory.0.count',
    );
    expect(() => parseScenario(inv({ book_id: 'b'.repeat(65) }))).toThrow(
      'scenario: character.inventory.0.book_id',
    );
    expect(() => parseScenario(inv({ book_id: '' }))).toThrow('book_id');
  });

  it('bounds skill_id and law rules', () => {
    const book = (skill_id: string): string =>
      JSON.stringify({
        ...base(),
        books: [{ id: 'bk_a', title: 'A', kind: 'skill', text: 't', skill_id }],
      });
    expect(() => parseScenario(book('s'.repeat(64)))).not.toThrow();
    expect(() => parseScenario(book('s'.repeat(65)))).toThrow('books.0.skill_id');
    const law = (rule: string): string =>
      JSON.stringify({ ...base(), laws: [{ rule, value: 'x' }] });
    expect(() => parseScenario(law('r'.repeat(256)))).not.toThrow();
    expect(() => parseScenario(law('r'.repeat(257)))).toThrow('laws.0.rule');
    expect(() => parseScenario(law(''))).toThrow('laws.0.rule');
  });
});
describe('law values', () => {
  const law = (value: unknown): string =>
    JSON.stringify({ ...base(), laws: [{ rule: 'chat', value }] });

  it('accepts any bounded JSON value', () => {
    for (const v of [5, 'quiet', true, null, [1, 2], { a: { b: { c: 1 } } }]) {
      expect(parseScenario(law(v)).laws[0]?.value).toEqual(v);
    }
  });

  it('rejects deep, large and long-string values', () => {
    expect(() => parseScenario(law({ a: { b: { c: { d: { e: 1 } } } } }))).toThrow('laws.0.value');
    expect(() => parseScenario(law(Array.from({ length: 400 }, () => 1234)))).toThrow(
      'laws.0.value',
    );
    expect(() => parseScenario(law('v'.repeat(257)))).toThrow('laws.0.value');
    expect(() => parseScenario(law(['v'.repeat(257)]))).toThrow('laws.0.value');
    expect(() => parseScenario(law('v'.repeat(256)))).not.toThrow();
  });
});
describe('applyOverrides', () => {
  it('lets flags beat the file and the file beat the defaults', () => {
    const s = parseScenario(
      JSON.stringify({ ...base(), day_length_seconds: 100, wake: { min_spacing_seconds: 7 } }),
    );
    const same = applyOverrides(s, {});
    expect(same.day_length_seconds).toBe(100);
    expect(same.wake.min_spacing_seconds).toBe(7);
    expect(same.wake.intent_run_too_long_seconds).toBe(300);
    const o = applyOverrides(s, {
      dayLengthSeconds: 24,
      minWakeSpacingSeconds: 1,
      intentRunTooLongSeconds: 9,
    });
    expect(o.day_length_seconds).toBe(24);
    expect(o.wake.min_spacing_seconds).toBe(1);
    expect(o.wake.intent_run_too_long_seconds).toBe(9);
    expect(s.day_length_seconds).toBe(100);
  });

  it('rejects out-of-range overrides', () => {
    const s = parseScenario(JSON.stringify(base()));
    for (const bad of [0, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(() => applyOverrides(s, { dayLengthSeconds: bad })).toThrow(
        'scenario: day_length_seconds: must be > 0',
      );
      expect(() => applyOverrides(s, { intentRunTooLongSeconds: bad })).toThrow(
        'scenario: wake.intent_run_too_long_seconds: must be > 0',
      );
    }
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyOverrides(s, { minWakeSpacingSeconds: bad })).toThrow(
        'scenario: wake.min_spacing_seconds: must be >= 0',
      );
    }
    expect(applyOverrides(s, { minWakeSpacingSeconds: 0 }).wake.min_spacing_seconds).toBe(0);
  });

  it('the schema also rejects a zero or tiny day length', () => {
    expect(() => parseScenario(JSON.stringify({ ...base(), day_length_seconds: 0 }))).toThrow(
      'scenario: day_length_seconds',
    );
    expect(() => parseScenario(JSON.stringify({ ...base(), day_length_seconds: 0.0001 }))).toThrow(
      'scenario: day_length_seconds',
    );
  });});
