import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { mapMindEvent } from '../mapper.ts';
import { PRESENT_HANDLERS, presentEvents } from '../present-handlers/index.ts';
import { visibleActorName } from './observation.ts';
import type { MapContext } from './types.ts';

const LIFE = 'ag_jason_01';
const AT = '2026-11-09T10:00:00.000Z';

function ctx(): MapContext {
  return { identity: { name: 'Jason', username: LIFE }, runs: new Map() };
}

/** A Mind event of `type` with `payload`; the cast is for the fixture only, as in handler-registry.test.ts. */
function event(type: string, payload: unknown, tick = 100): MindEvent {
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

const ZACK = { name: 'Zack', life: 'ag_zack_01' };
const GIFT = {
  kind: 'gift_received',
  actor: ZACK,
  item: 'bread',
  count: 3,
  key: 'gift:100:zack:bread:3:0',
};
const GIFT_UNATTRIBUTED = {
  kind: 'gift_received',
  item: 'bread',
  count: 3,
  key: 'gift:100:none:bread:3:0',
};
const BREAK = { kind: 'property_broken', block: 'chest', key: 'brk:100:1:64:3:none' };

/** The player lines of a Mind event, mapped then presented, as the tool presents them. */
function presented(e: MindEvent) {
  return presentEvents(PRESENT_HANDLERS, mapMindEvent(e, 3, ctx()));
}

describe('observation events on the player log', () => {
  it('each observation kind maps and presents, attributed and unattributed', () => {
    expect(presented(event('observation', GIFT))).toEqual([
      {
        seq: 3,
        tick: 100,
        type: 'gift_received',
        text: 'You received 3 bread.',
        actor: { name: 'Zack' },
        item: 'bread',
        count: 3,
      },
    ]);
    expect(presented(event('observation', GIFT_UNATTRIBUTED))).toEqual([
      {
        seq: 3,
        tick: 100,
        type: 'gift_received',
        text: 'You received 3 bread.',
        item: 'bread',
        count: 3,
      },
    ]);
    expect(presented(event('observation', BREAK))).toEqual([
      {
        seq: 3,
        tick: 100,
        type: 'property_broken',
        text: 'Someone broke your chest.',
        block: 'chest',
      },
    ]);
  });

  it('a name failing the pattern or holding a marked word is dropped and the event kept', () => {
    for (const name of ['Zack Two', 'Ab', 'Abcdefghijklmnopq', 'Watcher']) {
      const out = presented(event('observation', { ...GIFT, actor: { name, life: 'ag_zack_01' } }));
      expect(out, name).toHaveLength(1);
      expect(out[0], name).toMatchObject({ type: 'gift_received', text: 'You received 3 bread.' });
      expect(out[0], name).not.toHaveProperty('actor');
    }
    expect(visibleActorName('Zack')).toBe('Zack');
    expect(visibleActorName('Watcher')).toBeUndefined();
  });

  it('an old damage payload without actor maps and presents exactly as before', () => {
    expect(presented(event('damage', { amount: 2, cause: 'FALL' }))).toEqual([
      { seq: 3, tick: 100, type: 'damage', text: 'You fell.' },
    ]);
  });

  it('a damage with a visible actor names the actor and keeps the fixed sentence', () => {
    expect(presented(event('damage', { amount: 2, cause: 'ENTITY_ATTACK', actor: ZACK }))).toEqual([
      { seq: 3, tick: 100, type: 'damage', text: 'Something hit you.', actor: { name: 'Zack' } },
    ]);
  });

  it('a damage with an unfit actor name keeps the event without the name', () => {
    const out = presented(
      event('damage', { amount: 2, cause: 'ENTITY_ATTACK', actor: { name: 'Watcher' } }),
    );
    expect(out).toEqual([{ seq: 3, tick: 100, type: 'damage', text: 'Something hit you.' }]);
  });

  it('an item or block holding a marker word is dropped and the event kept', () => {
    const item = presented(event('observation', { ...GIFT_UNATTRIBUTED, item: 'watch' }));
    expect(item).toEqual([
      { seq: 3, tick: 100, type: 'gift_received', text: 'Something happened.', count: 3 },
    ]);
    const block = presented(
      event('observation', {
        kind: 'property_broken',
        block: 'observer',
        key: 'brk:100:1:64:3:none',
      }),
    );
    expect(block).toEqual([
      { seq: 3, tick: 100, type: 'property_broken', text: 'Something happened.' },
    ]);
  });

  it('an item with underscores is read as words: a phrase item is kept, a bare marker item is dropped', () => {
    const phrase = presented(
      event('observation', { ...GIFT_UNATTRIBUTED, item: 'echo_shard', count: 3 }),
    );
    expect(phrase).toEqual([
      {
        seq: 3,
        tick: 100,
        type: 'gift_received',
        text: 'You received 3 echo shard.',
        item: 'echo_shard',
        count: 3,
      },
    ]);
    const bare = presented(
      event('observation', { ...GIFT_UNATTRIBUTED, item: 'white_harness', count: 3 }),
    );
    expect(bare).toEqual([
      { seq: 3, tick: 100, type: 'gift_received', text: 'Something happened.', count: 3 },
    ]);
    const plain = presented(
      event('observation', { ...GIFT_UNATTRIBUTED, item: 'iron_ingot', count: 3 }),
    );
    expect(plain).toEqual([
      {
        seq: 3,
        tick: 100,
        type: 'gift_received',
        text: 'You received 3 iron ingot.',
        item: 'iron_ingot',
        count: 3,
      },
    ]);
  });

  it('a fight_seen or container_taken observation maps and presents no line', () => {
    const fight = { kind: 'fight_seen', target: 'zombie', key: 'fight:100:zombie:0' };
    const taken = { kind: 'container_taken', item: 'bread', count: 3, key: 'ctr:100:zack:bread:3' };
    expect(presented(event('observation', fight))).toEqual([]);
    expect(presented(event('observation', taken))).toEqual([]);
  });

  it('the presented event serialised holds no ag_ id, no key, no provenance and no coordinates', () => {
    const lines = [
      ...presented(event('observation', GIFT)),
      ...presented(event('observation', BREAK)),
      ...presented(event('damage', { amount: 2, cause: 'ENTITY_ATTACK', actor: ZACK })),
    ];
    const json = JSON.stringify(lines);
    expect(json).not.toMatch(/ag_/);
    expect(json).not.toMatch(/key|gift:|brk:|provenance/);
    expect(json).not.toMatch(/"(x|y|z)":/);
  });
});
