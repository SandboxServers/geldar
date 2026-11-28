import { readFileSync } from 'node:fs';
import type { SimEvent } from '@geldar/mcp-mock';
import { MIND_EVENT_TYPES } from '@geldar/player-core/src/link/mind-event.ts';
import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import type { MapContext } from './handlers/types.ts';
import { mapMindEvent } from './mapper.ts';
import { PRESENT_HANDLERS, presentEvents } from './present-handlers/index.ts';

/*
 * The leakage gate, delivery side (AN-28b). The golem cannot be imported here, so the observations below
 * are built by hand from the shapes of golem/src/perception/provenance/fixtures/{break,pickup}-real.json,
 * and each case states whether its actor was visible. This file checks only what the player is shown for
 * those inputs: no life id, provenance record, key, coordinate, or hidden name. Whether an actor is seen
 * at all is decided in golem, and is tested there by the leakage cases in
 * golem/src/perception/provenance/subscribe.test.ts.
 */

const LIFE = 'ag_adam_01';
const AT = '2026-11-20T10:00:00.000Z';
/** The player the Body can see: named, with a life id that must never reach the player. */
const VISIBLE = { name: 'Zack', life: 'ag_zack_01', basis: 'seen' };
/** The name of a player out of sight: it must never reach the player. */
const HIDDEN_NAME = 'Hidden_Walker';

const ctx = (): MapContext => ({ identity: { name: 'Adam', username: LIFE }, runs: new Map() });

function mind(type: string, payload: unknown, tick: number): MindEvent {
  return {
    type,
    payload,
    eventId: `evt-${type}-${tick}`,
    lifeId: LIFE,
    tick,
    day: 1,
    at: AT,
  } as unknown as MindEvent;
}

/** The player-facing events for a list of Mind events, the way the stream presents them. */
function presented(events: MindEvent[]): { sim: SimEvent[]; out: unknown[] } {
  const sim = events.flatMap((event, i) => mapMindEvent(event, i + 1, ctx()));
  return { sim, out: presentEvents(PRESENT_HANDLERS, sim) };
}

/** The mapped sim events for Mind events: what the mapper hands to the presenter, before any presenting. */
function mapped(events: MindEvent[]): SimEvent[] {
  return events.flatMap((event, i) => mapMindEvent(event, i + 1, ctx()));
}

/** The leaks in a serialised output: a life id, a provenance record, a key, or a coordinate triple. */
function leaksOf(out: unknown[]): string[] {
  const text = JSON.stringify(out);
  const leaks: string[] = [];
  if (/ag_[a-z0-9_]+/.test(text)) leaks.push('life id');
  if (/provenance/i.test(text)) leaks.push('provenance');
  if (/"key"/.test(text) || /\b(brk|gift|take|fight):/.test(text)) leaks.push('key');
  if (/\b\d{2,}\b\D{1,3}\b\d{2,}\b\D{1,3}\b\d{2,}\b/.test(text)) leaks.push('coordinates');
  if (text.includes(HIDDEN_NAME)) leaks.push('hidden name');
  return leaks;
}

/** The observation outputs only: the presented lines whose type is an observation kind. */
const observationsOf = (out: unknown[]): unknown[] =>
  out.filter((e) => {
    const type = (e as { type?: unknown }).type;
    return (
      type === 'gift_received' ||
      type === 'property_broken' ||
      type === 'fight_seen' ||
      type === 'container_taken'
    );
  });

/** A break of an owned block, in sight: the breaker is named (`observedActor`). From break-real.json. */
const BREAK_VISIBLE = mind(
  'observation',
  {
    kind: 'property_broken',
    actor: VISIBLE,
    block: 'cobblestone',
    key: 'brk:411:1313:200:800:ag_zack_01',
  },
  411,
);
/** The same break by a player out of sight: unattributed, the key says `none`. */
const BREAK_HIDDEN = mind(
  'observation',
  { kind: 'property_broken', block: 'cobblestone', key: 'brk:411:1313:200:800:none' },
  411,
);
/** A pickup of items thrown by a visible player. From pickup-real.json (distance 2). */
const GIFT_VISIBLE = mind(
  'observation',
  {
    kind: 'gift_received',
    actor: VISIBLE,
    item: 'cobblestone',
    count: 4,
    key: 'gift:1178:ag_zack_01:cobblestone:4:0',
  },
  1178,
);
/** A pickup of items thrown by a player out of sight: unattributed. */
const GIFT_HIDDEN = mind(
  'observation',
  { kind: 'gift_received', item: 'cobblestone', count: 4, key: 'gift:1178:none:cobblestone:4:0' },
  1178,
);
/** A hurt by a visible player: the actor is named; the hidden one has no actor at all. */
const HURT_VISIBLE = mind(
  'damage',
  { source: 'zombie', amount: 3, bearing: 'left', actor: VISIBLE },
  1178,
);
const HURT_HIDDEN = mind('damage', { source: 'zombie', amount: 3, bearing: 'left' }, 1178);

describe('the leakage gate: observed evidence reaches the player without ids, keys or hidden names', () => {
  it('a visible breaker and a visible thrower are named, with no life id, key or coordinate', () => {
    const { out } = presented([BREAK_VISIBLE, GIFT_VISIBLE, HURT_VISIBLE]);
    expect(observationsOf(out)).toHaveLength(2);
    expect(leaksOf(out)).toEqual([]);
    expect(JSON.stringify(out)).toContain('Zack');
  });

  it('a hidden breaker and a hidden thrower are unattributed: no name, no actor field', () => {
    const { out } = presented([BREAK_HIDDEN, GIFT_HIDDEN, HURT_HIDDEN]);
    expect(observationsOf(out)).toHaveLength(2);
    expect(leaksOf(out)).toEqual([]);
    for (const event of observationsOf(out)) expect(event).not.toHaveProperty('actor');
    expect(JSON.stringify(out)).not.toContain('Zack');
  });

  it('the recorded Body events (intent, plan, wake; no observation) replay with no leak', () => {
    const real = JSON.parse(
      readFileSync(new URL('../../test/fixtures/real-body-events.json', import.meta.url), 'utf8'),
    ) as { events: Array<{ type: string; payload: unknown; world_tick: number }> };
    const events = real.events.map((e) => mind(e.type, e.payload, e.world_tick));
    expect(leaksOf(presented(events).out)).toEqual([]);
  });

  it('an injected life id in an observation is never shown, and the gate still catches one', () => {
    const leaky = mind(
      'observation',
      {
        kind: 'gift_received',
        actor: { name: 'ag_zack_01', life: 'ag_zack_01' },
        item: 'bread',
        count: 1,
        key: 'gift:1:x:bread:1:0',
      },
      1,
    );
    expect(leaksOf(presented([leaky]).out)).toEqual([]);
    expect(leaksOf([{ text: 'ag_zack_01 broke your chest.' }])).toContain('life id');
  });

  it('an injected coordinate in an observation is reported as a leak', () => {
    const leaky = mind(
      'observation',
      { kind: 'property_broken', block: 'stone 1313 200 800', key: 'brk:411:1313:200:800:none' },
      411,
    );
    expect(leaksOf(presented([leaky]).out)).toContain('coordinates');
  });

  it('scanner test: a key in an output is reported as a leak', () => {
    expect(leaksOf([{ type: 'property_broken', key: 'brk:411:1313:200:800:none' }])).toContain(
      'key',
    );
  });

  it('scanner test: a hidden name in an output is reported as a leak', () => {
    expect(leaksOf([{ type: 'x', text: 'Hidden_Walker' }])).toContain('hidden name');
  });

  it('scanner test: the word provenance in an output is reported as a leak', () => {
    expect(leaksOf([{ type: 'property_broken', text: 'a provenance record' }])).toContain(
      'provenance',
    );
  });
});

/*
 * AN-50b: the two rows the Body's subscription adds to the active set. A fight names its fighter only when
 * the fighter is visible; a take names its taker only when the taker is visible with a basis (decision 0450). Hidden here means the
 * observation carries no actor at all.
 */
const FIGHT_VISIBLE = mind(
  'observation',
  { kind: 'fight_seen', actor: VISIBLE, target: 'zombie', key: 'fight:2631:ag_zack_01:zombie' },
  2631,
);
const FIGHT_HIDDEN = mind(
  'observation',
  { kind: 'fight_seen', target: 'zombie', key: 'fight:2631:none:zombie' },
  2631,
);
const TAKE_VISIBLE = mind(
  'observation',
  {
    kind: 'container_taken',
    actor: VISIBLE,
    item: 'cobblestone',
    count: 8,
    key: 'take:3982:1314:200:800:ag_zack_01:cobblestone',
  },
  3982,
);
const TAKE_HIDDEN = mind(
  'observation',
  {
    kind: 'container_taken',
    item: 'cobblestone',
    count: 8,
    key: 'take:3982:1314:200:800:-:cobblestone',
  },
  3982,
);

describe('the leakage gate: fight_seen and container_taken (AN-50b)', () => {
  // A fight or take names its actor only with a valid basis and a clean name (decision 0450).
  it('a visible fighter and a visible taker, with a basis, present lines that name them', () => {
    const { sim, out } = presented([FIGHT_VISIBLE, TAKE_VISIBLE]);
    expect(sim).toHaveLength(2);
    expect(out).toHaveLength(2);
    expect(observationsOf(out).map((e) => (e as { text: string }).text)).toEqual([
      'Zack fought a zombie nearby.',
      'Zack took 8 cobblestone from your container.',
    ]);
    for (const event of observationsOf(out)) expect(event).not.toHaveProperty('actor');
    expect(leaksOf(out)).toEqual([]);
  });

  it('without a basis, a digit name, a life id or a marker name, fight and take say Someone', () => {
    const actors = [
      { name: 'Zack', life: 'ag_zack_01' },
      { name: 'Zack2', life: 'ag_zack_01', basis: 'seen' },
      { name: 'ag_kestrel_01', life: 'ag_zack_01', basis: 'seen' },
      { name: '12345678', life: 'ag_zack_01', basis: 'seen' },
      { name: 'Watcher', life: 'ag_zack_01', basis: 'seen' },
    ];
    for (const actor of actors) {
      const fight = mind(
        'observation',
        { kind: 'fight_seen', actor, target: 'zombie', key: 'fight:2631:ag_zack_01:zombie' },
        2631,
      );
      const take = mind(
        'observation',
        {
          kind: 'container_taken',
          actor,
          item: 'cobblestone',
          count: 8,
          key: 'take:3982:1314:200:800:ag_zack_01:cobblestone',
        },
        3982,
      );
      const { out } = presented([fight, take]);
      expect(
        observationsOf(out).map((e) => (e as { text: string }).text),
        actor.name,
      ).toEqual([
        'Someone fought a zombie nearby.',
        'Someone took 8 cobblestone from your container.',
      ]);
      expect(leaksOf(out), actor.name).toEqual([]);
    }
  });

  it('a hidden fighter and a hidden taker present the same lines', () => {
    const { sim, out } = presented([FIGHT_HIDDEN, TAKE_HIDDEN]);
    expect(sim).toHaveLength(2);
    expect(out).toHaveLength(2);
    expect(leaksOf(out)).toEqual([]);
  });

  it('the mapped visible fight and take carry the visible name, and no life id, key or coordinate', () => {
    const sim = mapped([FIGHT_VISIBLE, TAKE_VISIBLE]);
    expect(sim).toHaveLength(2);
    expect(JSON.stringify(sim)).toContain('Zack');
    expect(leaksOf(sim)).toEqual([]);
  });

  it('the mapped hidden fight and take carry no actor and no hidden name', () => {
    const sim = mapped([FIGHT_HIDDEN, TAKE_HIDDEN]);
    expect(sim).toHaveLength(2);
    for (const event of sim) expect(event).not.toHaveProperty('actor');
    expect(leaksOf(sim)).toEqual([]);
  });

  it('an input container_taken that carries actor.life maps with no life id', () => {
    const injected = mind(
      'observation',
      {
        kind: 'container_taken',
        actor: { name: 'Zack', life: 'ag_zack_01', basis: 'seen' },
        item: 'cobblestone',
        count: 8,
        key: 'take:3982:1314:200:800:ag_zack_01:cobblestone',
      },
      3982,
    );
    const sim = mapped([injected]);
    expect(sim).toHaveLength(1);
    expect(JSON.stringify(sim)).toContain('Zack');
    expect(leaksOf(sim)).toEqual([]);
  });

  it('scanner test: a life field on a container_taken object is reported as a leak', () => {
    const leaky = { type: 'container_taken', actor: { name: 'Zack', life: 'ag_zack_01' } };
    expect(leaksOf([leaky])).toContain('life id');
  });

  it('scanner test: a key on a fight_seen object is reported as a leak', () => {
    expect(leaksOf([{ type: 'fight_seen', key: 'fight:2631:ag_zack_01:zombie' }])).toContain('key');
  });

  it('scanner test: a take or fight key prefix in an output is reported as a leak', () => {
    expect(leaksOf([{ type: 'x', text: 'take:3982:1314:200:800:-:cobblestone' }])).toContain('key');
    expect(leaksOf([{ type: 'x', text: 'fight:2631:none:zombie' }])).toContain('key');
  });

  it('a raw provenance record and a combat_fact never reach the agent', () => {
    expect(MIND_EVENT_TYPES).not.toContain('combat_fact');
    expect(MIND_EVENT_TYPES.some((type) => type.includes('provenance'))).toBe(false);
    const raw = [
      mind('provenance.break', { kind: 'break', world: 'world', x: 1313, y: 200, z: 800 }, 411),
      mind('combat_fact', { kind: 'engaged', actor: 'ag_zack_01', target: 'zombie' }, 1200),
    ];
    const { sim, out } = presented(raw);
    expect(sim).toEqual([]);
    expect(out).toEqual([]);
  });
});
