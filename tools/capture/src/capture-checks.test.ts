import { describe, expect, it } from 'vitest';
import {
  checkCapture,
  checkExpect,
  formatTable,
  parseExpect,
  subjectKind,
} from './capture-checks.ts';

// Hand-built messages (not captures): they exercise the contract checks, nothing else.
const BREAK = {
  kind: 'break',
  world: 'world',
  x: 10,
  y: 64,
  z: -3,
  actor: null,
  prior_owner: null,
  block: 'stone',
  tick: 1200,
};
const PICKUP = {
  kind: 'pickup',
  world: 'world',
  picker: 'GolemPick',
  thrower: null,
  item: 'stick',
  count: 3,
  age_ticks: 40,
  distance: null,
  tick: 1200,
};
const TAKE = {
  world: 'world',
  x: 10,
  y: 64,
  z: -3,
  actor: 'GolemChest',
  prior_owner: 'ag_kestrel_01',
  item: 'iron_ingot',
  count: 2,
  tick: 1300,
};
const COMBAT = {
  world: 'world',
  actor: 'GolemCombat',
  target: 'zombie',
  kind: 'killed',
  tick: 1400,
};
const PAYLOAD = {
  player: 'ag_kestrel_01',
  life_id: 'ag_kestrel_01',
  kind: 'hostile_kill',
  mob: 'zombie',
  encounter_key: 'enc:ag_kestrel_01:6f1c2b8e-3d4a-4b5c-9e6f-7a8b9c0d1e2f',
};
function envelope(payload: unknown, type = 'combat_fact'): Record<string, unknown> {
  return {
    source_event_id: 'ev_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    at: '2026-11-19T12:00:00Z',
    shard: 'phase0',
    world_day: 3,
    world_tick: 1400,
    type,
    agent_id: 'ag_kestrel_01',
    payload,
  };
}
const file = 'f.json';
function check(subject: string, value: unknown) {
  return checkCapture({
    file,
    subject,
    text: typeof value === 'string' ? value : JSON.stringify(value),
  });
}
const P = 'geldar.phase0.provenance';
const CF = 'geldar.phase0.combat_fact';

describe('subjectKind', () => {
  it('maps the four provenance tails and combat_fact, for any shard name', () => {
    expect(subjectKind(`${P}.break`)).toBe('break');
    expect(subjectKind(`${P}.pickup`)).toBe('pickup');
    expect(subjectKind(`${P}.take`)).toBe('take');
    expect(subjectKind(`${P}.combat`)).toBe('combat');
    expect(subjectKind(CF)).toBe('combat_fact');
    expect(subjectKind('geldar.colo.combat_fact')).toBe('combat_fact');
  });

  it('returns null for a subject the session does not capture', () => {
    expect(subjectKind('geldar.phase0.provenance.other')).toBeNull();
    expect(subjectKind(`${CF}.extra`)).toBeNull();
    expect(subjectKind('body.phase0.state')).toBeNull();
  });
});

describe('checkCapture: provenance', () => {
  it('passes a valid break and prints prior_owner as it is (null here)', () => {
    const rows = check(`${P}.break`, BREAK);
    expect(rows).toEqual([
      { case: 'break', file, schema: 'pass', result: 'pass', detail: 'prior_owner=null' },
    ]);
  });

  it('fails a break with a field missing (the schema is additionalProperties false)', () => {
    const { tick: _tick, ...noTick } = BREAK;
    expect(check(`${P}.break`, noTick)[0]?.result).toBe('fail');
    expect(check(`${P}.break`, { ...BREAK, extra: 1 })[0]?.result).toBe('fail');
  });

  it('passes a valid pickup and fails a pickup whose count is 0', () => {
    expect(check(`${P}.pickup`, PICKUP)[0]?.result).toBe('pass');
    expect(check(`${P}.pickup`, { ...PICKUP, count: 0 })[0]?.result).toBe('fail');
  });

  it('passes a take and prints item and count; fails a take with a count above a stack of the largest kind', () => {
    expect(check(`${P}.take`, TAKE)[0]).toMatchObject({
      schema: 'pass',
      detail: 'item=iron_ingot count=2',
    });
    expect(check(`${P}.take`, { ...TAKE, count: 99999 })[0]?.result).toBe('fail');
  });

  it('passes a combat provenance of kind killed and fails one of an unknown kind', () => {
    expect(check(`${P}.combat`, COMBAT)[0]?.result).toBe('pass');
    expect(check(`${P}.combat`, { ...COMBAT, kind: 'hit' })[0]?.result).toBe('fail');
  });

  it('fails a payload that is not JSON, and an unknown subject', () => {
    expect(check(`${P}.break`, '{not json')[0]).toMatchObject({ schema: 'fail', result: 'fail' });
    expect(check('geldar.phase0.provenance.other', BREAK)[0]).toMatchObject({
      case: '?',
      result: 'fail',
    });
  });
});

describe('checkCapture: combat_fact (the WorldEvent envelope and its payload)', () => {
  it('passes a valid kill: schema, the player key, and the encounter life part equal to life_id', () => {
    const rows = check(CF, envelope(PAYLOAD));
    expect(rows.map((r) => [r.schema, r.result])).toEqual([
      ['pass', 'pass'],
      ['n/a', 'pass'],
      ['n/a', 'pass'],
    ]);
  });

  it('fails the envelope check when a WorldEvent field is missing (validateWorldEvent is the check)', () => {
    const { shard: _shard, ...noShard } = envelope(PAYLOAD);
    const rows = check(CF, noShard);
    expect(rows[0]).toMatchObject({ schema: 'fail', result: 'fail' });
    expect(rows[0]?.detail).toContain('shard');
  });

  it('fails the payload check when the payload has an unknown key (validateCombatFactPayload is the check)', () => {
    const rows = check(CF, envelope({ ...PAYLOAD, bogus: 1 }));
    expect(rows[0]).toMatchObject({ schema: 'fail', result: 'fail' });
  });

  it('fails the envelope when its type is not combat_fact', () => {
    expect(check(CF, envelope(PAYLOAD, 'action'))[0]?.detail).toContain('not combat_fact');
  });

  it('fails the player claim when the payload has no player key (the schema allows it, so only the claim row fails)', () => {
    const { player: _player, ...noPlayer } = PAYLOAD;
    const rows = check(CF, envelope(noPlayer));
    expect(rows[0]).toMatchObject({ schema: 'pass', result: 'pass' });
    expect(rows[1]).toMatchObject({ result: 'fail', detail: 'player key present=false' });
  });

  it('fails the life claim when the encounter key names another life than life_id', () => {
    const other = {
      ...PAYLOAD,
      encounter_key: 'enc:ag_other_01:6f1c2b8e-3d4a-4b5c-9e6f-7a8b9c0d1e2f',
    };
    const rows = check(CF, envelope(other));
    expect(rows[0]?.result).toBe('pass');
    expect(rows[2]).toMatchObject({ result: 'fail' });
  });
});

describe('parseExpect and checkExpect', () => {
  it('parses case=count lists and rejects unknown cases and bad counts', () => {
    expect([...parseExpect('break=2, combat_fact=1')]).toEqual([
      ['break', 2],
      ['combat_fact', 1],
    ]);
    expect(() => parseExpect('nope=1')).toThrow(/unknown case/);
    expect(() => parseExpect('break=x')).toThrow(/bad count/);
    expect(() => parseExpect('break')).toThrow(/bad count/);
  });

  it('fails a case that has fewer files than expected and passes one that has enough', () => {
    const rows = [...check(`${P}.break`, BREAK)];
    const out = checkExpect(rows, parseExpect('break=2,pickup=0'));
    expect(out.map((r) => [r.case, r.result, r.detail])).toEqual([
      ['break', 'fail', 'expected at least 2, found 1'],
      ['pickup', 'pass', 'expected at least 0, found 0'],
    ]);
  });

  it('prints a table with the five columns', () => {
    const table = formatTable(check(`${P}.break`, BREAK));
    expect(table.split('\n')[0]).toMatch(/^case\s+file\s+schema\s+result\s+detail$/);
    expect(table).toContain('prior_owner=null');
  });
});
