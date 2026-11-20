import { readFileSync } from 'node:fs';
import {
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
  validateProvenance,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { OwnerTransport } from '../../body/block-owners.ts';
import { HIDDEN_LIFE, HIDDEN_NAME, leaksIn } from './leakage-scan.ts';
import { type ObservationOptions, startObservations } from './subscribe.ts';

/*
 * The four active observation rows of the Body's subscription (AN-50b): gift, break, take and fight. Each
 * row has a positive control, a hidden control, a repeat control and a restart control. The rest of the file
 * covers the guards that stop a row from being observed at all (world, kind, ownership, age), the wrong
 * subject, and the golem-side leakage scan over every published body, with each scan injected.
 */

const SHARD = 'phase0';
const BODY = 'ag_capa_01';
const OTHER = 'ag_capb_02';
const SUBJECT = {
  break: provenanceBreakSubject(SHARD),
  pickup: provenancePickupSubject(SHARD),
  take: provenanceTakeSubject(SHARD),
  combat: provenanceCombatSubject(SHARD),
};
/** The Body stands here. A visible actor stands 3 blocks west; a hidden one 3 blocks east behind WALL. */
const ORIGIN = new Vec3(1310.5, 200, 800.5);
const WEST = new Vec3(1307.5, 200, 800.5);
const EAST = new Vec3(1313.5, 200, 800.5);
/** The chest the take fixture names. A container is seen only when its block is itself a solid hit. */
const TAKE_CELL = new Vec3(1314, 200, 800);
/** A three-block wall: a sight line at any eye height from ORIGIN to EAST is blocked. */
const WALL = [new Vec3(1312, 200, 800), new Vec3(1312, 201, 800), new Vec3(1312, 202, 800)];
/** A zombie 6 blocks south, in sight; one 30 blocks south, out of reach. */
const MOB = new Vec3(1310.5, 200, 806.5);
const FAR_MOB = new Vec3(1310.5, 200, 830.5);
/** The world age: past every message tick in this file, so no message is stamped in the future. */
const AGE = 5000;

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const BREAK = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
const PICKUP = fixture('pickup-real.json');
const TAKE = fixture('take-real.json').chest_single_withdraw as Record<string, unknown>;
const COMBAT = fixture('combat-real.json').kill_engaged as Record<string, unknown>;

/** The take the Body owns, taken by `actor`. */
const take = (over: Record<string, unknown> = {}) => ({
  ...TAKE,
  prior_owner: BODY,
  actor: OTHER,
  ...over,
});
/** An `engaged` fight by `actor` on a zombie (the captured record with the fighter changed). */
const engaged = (over: Record<string, unknown> = {}) => ({
  ...COMBAT,
  actor: OTHER,
  kind: 'engaged',
  ...over,
});

interface Sub {
  subject: string;
  opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void };
  unsubscribed: boolean;
}

/** A NATS stand-in: records each subscription and delivers a message to the ones on its subject. */
function fakeTransport() {
  const subs: Sub[] = [];
  const transport: OwnerTransport = {
    request: async () => {
      throw new Error('not used');
    },
    subscribe(subject, opts) {
      const sub: Sub = { subject, opts, unsubscribed: false };
      subs.push(sub);
      return {
        unsubscribe() {
          sub.unsubscribed = true;
        },
      };
    },
  };
  const deliver = (subject: string, body: unknown): void => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const data = new TextEncoder().encode(text);
    for (const sub of subs) if (sub.subject === subject) sub.opts.callback(null, { data });
  };
  return { transport, subs, deliver };
}

interface Scene {
  /** The world age; `undefined` makes it unknown. Defaults to AGE. */
  age?: number | undefined;
  solids?: Vec3[];
  mobs?: Array<[string, Vec3]>;
  players?: Array<[string, Vec3]>;
}

/** A Body in the overworld at ORIGIN. Every block is a chest; a ray meets the solids it passes. */
function botFor(scene: Scene = {}): Bot {
  const entities: Record<number, unknown> = {};
  (scene.mobs ?? []).forEach(([name, position], i) => {
    entities[i + 1] = { type: 'mob', name, position, height: 1.95 };
  });
  (scene.players ?? []).forEach(([username, position], i) => {
    entities[100 + i] = { type: 'player', username, position, height: 1.8 };
  });
  const solids = scene.solids ?? [TAKE_CELL];
  return {
    username: BODY,
    entity: { position: ORIGIN.clone() },
    entities,
    game: { dimension: 'minecraft:overworld' },
    time: { age: 'age' in scene ? scene.age : AGE },
    world: {
      raycast: (start: Vec3, dir: Vec3, range: number) => {
        for (let t = 0; t <= range; t += 0.05) {
          const cell = start.plus(dir.scaled(t)).floored();
          const hit = solids.find((solid) => solid.equals(cell));
          if (hit) return { position: hit };
        }
        return null;
      },
    },
    blockAt: (p: Vec3) => ({ position: p, name: 'chest' }),
  } as unknown as Bot;
}

const RESOLVE_OTHER = (name: string | undefined) =>
  name === OTHER ? { name: OTHER, life: OTHER } : null;

/** A started subscription over a fresh transport, with the messages it publishes collected. */
function open(bot: Bot, overrides: Partial<ObservationOptions> = {}) {
  const net = fakeTransport();
  const published: string[] = [];
  const logs: string[] = [];
  const options: ObservationOptions = {
    transport: net.transport,
    shard: SHARD,
    lifeId: BODY,
    selfName: BODY,
    bot,
    publisher: {
      publish: async (_subject, body) => {
        published.push(body);
      },
    },
    resolve: RESOLVE_OTHER,
    canSee: () => true,
    log: (line) => logs.push(line),
    ...overrides,
  };
  const sub = startObservations(options);
  return { net, published, logs, sub, options };
}

/** The payloads of the published observation bodies. */
const payloadsOf = (published: string[]) =>
  published.map((body) => JSON.parse(body) as { payload: Record<string, unknown> });

/** A body the scan reads: the payload, with the agent id it is for. */
const bodyWith = (payload: Record<string, unknown>) => JSON.stringify({ agent_id: BODY, payload });

describe('the fixtures this file uses', () => {
  it('the take fixture is the captured chest withdrawal, and every message is a valid provenance record', () => {
    expect(TAKE).toEqual({
      world: 'world',
      x: 1314,
      y: 200,
      z: 800,
      actor: 'ag_capa_01',
      prior_owner: null,
      item: 'cobblestone',
      count: 8,
      tick: 3982,
    });
    for (const msg of [TAKE, take(), engaged(), BREAK, PICKUP]) {
      expect(validateProvenance(msg)).toBe(true);
    }
  });
});

describe('gift row (AN-26): the Body receives an item', () => {
  // The Body is the picker: it is `OTHER` here, as in the AN-28b gift cases.
  const giftOpen = (overrides: Partial<ObservationOptions> = {}) =>
    open(botFor(), {
      selfName: OTHER,
      lifeId: OTHER,
      resolve: (name) => (name === BODY ? { name: BODY, life: BODY } : null),
      ...overrides,
    });

  it('positive: a thrower in sight is named, once', () => {
    const { net, published, sub } = giftOpen();
    net.deliver(SUBJECT.pickup, PICKUP);
    expect(payloadsOf(published)).toMatchObject([
      { payload: { kind: 'gift_received', actor: { name: BODY }, item: 'cobblestone', count: 4 } },
    ]);
    sub.stop();
  });

  it('hidden: a thrower out of sight is unattributed', () => {
    const { net, published, sub } = giftOpen({ resolve: () => null });
    net.deliver(SUBJECT.pickup, { ...PICKUP, thrower: HIDDEN_NAME, tick: 1179 });
    expect(payloadsOf(published)).toHaveLength(1);
    expect(payloadsOf(published)[0]?.payload).not.toHaveProperty('actor');
    expect(published[0]?.toLowerCase()).not.toContain(HIDDEN_NAME.toLowerCase());
    sub.stop();
  });

  it('identical pickups in one tick are two observations, keys :0 and :1 (ordinal by design, no dedupe; not a duplicate control)', () => {
    const { net, published, sub } = giftOpen();
    net.deliver(SUBJECT.pickup, PICKUP);
    net.deliver(SUBJECT.pickup, PICKUP);
    expect(payloadsOf(published).map((p) => String(p.payload.key).split(':').pop())).toEqual([
      '0',
      '1',
    ]);
    sub.stop();
  });

  it('restart: a new subscription has fresh state, requests no replay, and observes the same pickup once', () => {
    const { net, published, sub, options } = giftOpen();
    net.deliver(SUBJECT.pickup, PICKUP);
    sub.stop();
    const again = startObservations(options);
    for (const s of net.subs.slice(4)) expect(Object.keys(s.opts)).toEqual(['callback']);
    net.deliver(SUBJECT.pickup, PICKUP);
    expect(published).toHaveLength(2);
    again.stop();
  });
});

describe("break row (AN-27): the Body's owned block is broken", () => {
  it('positive: a breaker in sight is named, once', () => {
    const { net, published, sub } = open(botFor());
    net.deliver(SUBJECT.break, BREAK);
    expect(payloadsOf(published)).toMatchObject([
      { payload: { kind: 'property_broken', actor: { name: OTHER }, block: 'cobblestone' } },
    ]);
    sub.stop();
  });

  it('hidden: a breaker out of sight is unattributed', () => {
    const { net, published, sub } = open(botFor(), { resolve: () => null });
    net.deliver(SUBJECT.break, { ...BREAK, actor: HIDDEN_LIFE, tick: 412 });
    expect(payloadsOf(published)[0]?.payload).not.toHaveProperty('actor');
    expect(published[0]?.toLowerCase()).not.toContain(HIDDEN_LIFE);
    sub.stop();
  });

  it('duplicate: the same break twice is one observation', () => {
    const { net, published, sub } = open(botFor());
    net.deliver(SUBJECT.break, BREAK);
    net.deliver(SUBJECT.break, BREAK);
    expect(published).toHaveLength(1);
    sub.stop();
  });

  it('restart: after stop the same break is observed once by a fresh subscription, with no replay', () => {
    const { net, published, sub, options } = open(botFor());
    net.deliver(SUBJECT.break, BREAK);
    sub.stop();
    const again = startObservations(options);
    for (const s of net.subs.slice(4)) expect(Object.keys(s.opts)).toEqual(['callback']);
    net.deliver(SUBJECT.break, BREAK);
    expect(published).toHaveLength(2);
    again.stop();
  });
});

describe("take row (AN-51): the Body's container is taken from", () => {
  it('positive: a taker in sight is named on the container_taken observation, once', () => {
    const { net, published, sub } = open(botFor({ players: [[OTHER, WEST]] }));
    net.deliver(SUBJECT.take, take());
    expect(payloadsOf(published)).toMatchObject([
      {
        payload: {
          kind: 'container_taken',
          actor: { name: OTHER, life: OTHER },
          item: 'cobblestone',
          count: 8,
        },
      },
    ]);
    sub.stop();
  });

  it('hidden: a taker out of sight is unattributed and their name is not in the body', () => {
    const { net, published, sub } = open(botFor(), { resolve: () => null });
    net.deliver(SUBJECT.take, take({ actor: HIDDEN_NAME }));
    expect(payloadsOf(published)).toHaveLength(1);
    expect(payloadsOf(published)[0]?.payload).not.toHaveProperty('actor');
    expect(published[0]?.toLowerCase()).not.toContain(HIDDEN_NAME.toLowerCase());
    sub.stop();
  });

  it('hidden: a taker behind a wall is unattributed, though the container is seen', () => {
    const wallWest = [new Vec3(1308, 200, 800), new Vec3(1308, 201, 800), new Vec3(1308, 202, 800)];
    const { net, published, sub } = open(
      botFor({ players: [[OTHER, WEST]], solids: [TAKE_CELL, ...wallWest] }),
    );
    net.deliver(SUBJECT.take, take());
    expect(payloadsOf(published)).toHaveLength(1);
    expect(payloadsOf(published)[0]?.payload).not.toHaveProperty('actor');
    expect(leaksIn(published[0] ?? '', [BODY])).toEqual([]);
    sub.stop();
  });

  it('duplicate: the same take twice is one observation', () => {
    const { net, published, sub } = open(botFor());
    net.deliver(SUBJECT.take, take());
    net.deliver(SUBJECT.take, take());
    expect(published).toHaveLength(1);
    sub.stop();
  });

  it('restart: a fresh subscription has no take keys, requests no replay, and observes the same take once', () => {
    const { net, published, sub, options } = open(botFor());
    net.deliver(SUBJECT.take, take());
    sub.stop();
    const again = startObservations(options);
    for (const s of net.subs.slice(4)) expect(Object.keys(s.opts)).toEqual(['callback']);
    net.deliver(SUBJECT.take, take());
    expect(published).toHaveLength(2);
    again.stop();
  });

  it('the take keys and the break keys have separate LRUs: 257 takes do not evict a break key', () => {
    const { net, published, sub } = open(botFor({ players: [[OTHER, WEST]] }));
    net.deliver(SUBJECT.break, BREAK);
    for (let i = 0; i < 257; i += 1) net.deliver(SUBJECT.take, take({ tick: 3000 + i }));
    net.deliver(SUBJECT.break, BREAK);
    const kinds = payloadsOf(published).map((p) => p.payload.kind);
    expect(kinds.filter((kind) => kind === 'property_broken')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'container_taken')).toHaveLength(257);
    sub.stop();
  });

  it('a container the Body cannot see gives nothing', () => {
    const { net, published, sub } = open(botFor({ solids: [...WALL, TAKE_CELL] }));
    net.deliver(SUBJECT.take, take());
    expect(published).toHaveLength(0);
    sub.stop();
  });

  it('a take from a container nobody owns, from another owner, or taken by the Body gives nothing', () => {
    const { net, published, sub } = open(botFor());
    net.deliver(SUBJECT.take, take({ prior_owner: null }));
    net.deliver(SUBJECT.take, take({ prior_owner: 'ag_capc_03' }));
    net.deliver(SUBJECT.take, take({ actor: BODY, tick: 3983 }));
    expect(published).toHaveLength(0);
    sub.stop();
  });
});

describe('fight row (AN-47c): a visible player hits a mob in view', () => {
  it('positive: a fighter in sight and a mob in view is named, once', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.combat, engaged());
    expect(payloadsOf(published)).toMatchObject([
      { payload: { kind: 'fight_seen', actor: { name: OTHER, life: OTHER }, target: 'zombie' } },
    ]);
    sub.stop();
  });

  it('hidden: a fighter out of sight is not named, and nothing is observed', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }), {
      resolve: () => null,
    });
    net.deliver(SUBJECT.combat, engaged({ actor: HIDDEN_NAME }));
    expect(published).toHaveLength(0);
    sub.stop();
  });

  it('hidden: a mob behind a wall, a mob out of reach, or no mob of the target type gives nothing', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', EAST]], solids: WALL }));
    net.deliver(SUBJECT.combat, engaged());
    const far = open(botFor({ mobs: [['zombie', FAR_MOB]] }));
    far.net.deliver(SUBJECT.combat, engaged());
    const other = open(botFor({ mobs: [['skeleton', MOB]] }));
    other.net.deliver(SUBJECT.combat, engaged());
    expect(published).toHaveLength(0);
    expect(far.published).toHaveLength(0);
    expect(other.published).toHaveLength(0);
    sub.stop();
    far.sub.stop();
    other.sub.stop();
  });

  it('duplicate: the same fight twice, and the same pair a tick later, is one observation', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.combat, engaged());
    net.deliver(SUBJECT.combat, engaged());
    net.deliver(SUBJECT.combat, engaged({ tick: 2632 }));
    expect(published).toHaveLength(1);
    sub.stop();
  });

  it('restart: a fresh subscription has no fight windows, requests no replay, and observes the same fight once', () => {
    const { net, published, sub, options } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.combat, engaged());
    sub.stop();
    const again = startObservations(options);
    for (const s of net.subs.slice(4)) expect(Object.keys(s.opts)).toEqual(['callback']);
    net.deliver(SUBJECT.combat, engaged());
    expect(published).toHaveLength(2);
    again.stop();
  });
});

describe('the guards: world, kind, own fight, and an unknown world age', () => {
  it('a take and a fight in another world give nothing; the same world gives one of each', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.take, take({ world: 'world_nether' }));
    net.deliver(SUBJECT.combat, engaged({ world: 'world_nether' }));
    expect(published).toHaveLength(0);
    net.deliver(SUBJECT.take, take());
    net.deliver(SUBJECT.combat, engaged());
    expect(published).toHaveLength(2);
    sub.stop();
  });

  it("a killed message and the Body's own fight give nothing on the combat subject", () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.combat, engaged({ kind: 'killed' }));
    net.deliver(SUBJECT.combat, COMBAT);
    expect(published).toHaveLength(0);
    expect(COMBAT.actor).toBe(BODY);
    sub.stop();
  });

  it('with the world age unknown, a take and a fight are not observed, and nothing throws', () => {
    const { net, published, logs, sub } = open(botFor({ age: undefined, mobs: [['zombie', MOB]] }));
    expect(() => {
      net.deliver(SUBJECT.take, take());
      net.deliver(SUBJECT.combat, engaged());
    }).not.toThrow();
    expect(published).toHaveLength(0);
    // Refused by the guard itself, not by the contract's world-tick check downstream.
    expect(logs).toEqual([]);
    sub.stop();
  });

  it('a message of the wrong kind for its subject is dropped as malformed, and publishes nothing', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.take, BREAK);
    net.deliver(SUBJECT.combat, BREAK);
    net.deliver(SUBJECT.break, take());
    net.deliver(SUBJECT.pickup, engaged());
    expect(sub.dropped()).toEqual({ oversize: 0, malformed: 4, failed: 0 });
    expect(published).toHaveLength(0);
    sub.stop();
  });

  it('after stop, a take and a fight are ignored', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    sub.stop();
    net.deliver(SUBJECT.take, take());
    net.deliver(SUBJECT.combat, engaged());
    expect(published).toHaveLength(0);
  });
});

describe('the golem-side leakage scan over every published observation', () => {
  it('no published body leaks a provenance word, a coordinate, a foreign life id or a hidden actor', () => {
    const { net, published, sub } = open(botFor({ mobs: [['zombie', MOB]] }));
    net.deliver(SUBJECT.break, BREAK);
    net.deliver(SUBJECT.break, { ...BREAK, actor: HIDDEN_LIFE, tick: 412 });
    net.deliver(SUBJECT.take, take());
    net.deliver(SUBJECT.take, take({ actor: HIDDEN_NAME, tick: 3983 }));
    net.deliver(SUBJECT.combat, engaged());
    net.deliver(SUBJECT.combat, engaged({ actor: HIDDEN_NAME }));
    expect(published.length).toBeGreaterThanOrEqual(3);
    for (const body of published) expect(leaksIn(body, [BODY, OTHER])).toEqual([]);
    sub.stop();
  });

  it('injected: a provenance word in a body is reported', () => {
    expect(leaksIn(bodyWith({ kind: 'fight_seen', note: 'a provenance record' }), [BODY])).toEqual([
      'provenance',
    ]);
  });

  it('injected: coordinates in a payload field are reported; the key is not scanned for them', () => {
    expect(leaksIn(bodyWith({ kind: 'container_taken', item: '1314 200 800' }), [BODY])).toEqual([
      'coordinates',
    ]);
    const keyed = bodyWith({
      kind: 'container_taken',
      key: 'take:3982:1314:200:800:-:cobblestone',
    });
    expect(leaksIn(keyed, [BODY])).toEqual([]);
  });

  it('injected: a life id outside the allow-list is reported', () => {
    expect(
      leaksIn(bodyWith({ kind: 'fight_seen', actor: { name: 'x', life: 'ag_capz_09' } }), [
        BODY,
        OTHER,
      ]),
    ).toEqual(['life id ag_capz_09']);
  });

  it('injected: an uppercase life id in a payload is reported in lower case, and an uppercase allow-list entry still matches', () => {
    expect(leaksIn(bodyWith({ kind: 'x', note: 'AG_ZACK_01' }), [BODY, OTHER])).toEqual([
      'life id ag_zack_01',
    ]);
    expect(leaksIn(bodyWith({ kind: 'x', note: 'AG_CAPA_01' }), [BODY.toUpperCase()])).toEqual([]);
  });

  it('injected: a hidden name or life id in any case is reported, in the key too', () => {
    const upper = bodyWith({ kind: 'container_taken', key: 'take:1:1:1:1:HIDDEN_WALKER:x' });
    expect(leaksIn(upper, [BODY])).toEqual(['hidden actor']);
    const life = bodyWith({ kind: 'property_broken', key: 'brk:1:1:1:1:AG_CAPC_03' });
    expect(leaksIn(life, [BODY])).toContain('hidden actor');
  });
});
