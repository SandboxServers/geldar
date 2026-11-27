import { readFileSync } from 'node:fs';
import {
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerTransport } from '../../body/block-owners.ts';
import type { EventPublisher } from '../../body/records-nats.ts';
import { HIDDEN_LIFE, HIDDEN_NAME, leaksIn } from './leakage-scan.ts';
import {
  MAX_PROVENANCE_BYTES,
  type ObservationOptions,
  startBodyObservations,
  startObservations,
} from './subscribe.ts';

const SHARD = 'phase0';
const BODY = 'ag_capa_01';
const OTHER = 'ag_capb_02';
const BREAK_SUBJECT = provenanceBreakSubject(SHARD);
const PICKUP_SUBJECT = provenancePickupSubject(SHARD);
const TAKE_SUBJECT = provenanceTakeSubject(SHARD);
const COMBAT_SUBJECT = provenanceCombatSubject(SHARD);

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

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
  const deliver = (subject: string, body: string | Uint8Array): void => {
    const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    for (const sub of subs) if (sub.subject === subject) sub.opts.callback(null, { data });
  };
  return { transport, subs, deliver };
}

/** A Body in `dimension` standing 6 blocks from the fixture's cell, with a fixed world age. */
function fakeBot(dimension = 'minecraft:overworld'): Bot {
  return {
    entity: { position: new Vec3(1310, 200, 800) },
    game: { dimension },
    time: { age: 411 },
  } as unknown as Bot;
}

const RESOLVE_OTHER = (name: string | undefined) =>
  name === OTHER ? { name: OTHER, life: OTHER } : null;

function setup(overrides: Partial<ObservationOptions> = {}) {
  const net = fakeTransport();
  const published: Array<{ subject: string; body: string; msgId: string }> = [];
  const logs: string[] = [];
  const publisher: EventPublisher = {
    publish: async (subject, body, msgId) => {
      published.push({ subject, body, msgId });
    },
  };
  const sub = startObservations({
    transport: net.transport,
    shard: SHARD,
    lifeId: BODY,
    selfName: BODY,
    bot: fakeBot(),
    publisher,
    resolve: RESOLVE_OTHER,
    canSee: () => true,
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { ...net, sub, published, logs };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('startObservations', () => {
  it('observations on: all four subjects subscribed and stop unsubscribes all four', () => {
    const net = setup();
    expect(net.subs.map((s) => s.subject)).toEqual([
      BREAK_SUBJECT,
      PICKUP_SUBJECT,
      TAKE_SUBJECT,
      COMBAT_SUBJECT,
    ]);
    net.sub.stop();
    expect(net.subs.map((s) => s.unsubscribed)).toEqual([true, true, true, true]);
  });

  it('subscribes with a callback only: no replay option, no JetStream', () => {
    const net = setup();
    for (const sub of net.subs) expect(Object.keys(sub.opts)).toEqual(['callback']);
    net.sub.stop();
  });

  it('a message after stop is ignored', async () => {
    const net = setup();
    net.sub.stop();
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toEqual([]);
  });

  it('a provenance message with a bad shape is dropped and counted', () => {
    const net = setup();
    net.deliver(BREAK_SUBJECT, JSON.stringify({ kind: 'break', world: 5 }));
    net.deliver(BREAK_SUBJECT, 'not json');
    expect(net.sub.dropped()).toEqual({ oversize: 0, malformed: 2, failed: 0 });
    expect(net.logs).toHaveLength(2);
    expect(net.logs.join('\n')).not.toContain(BODY);
    net.sub.stop();
  });

  it('a message of the wrong kind for its subject is dropped as malformed: all 12 pairings publish nothing', () => {
    const net = setup();
    type Channel = 'break' | 'pickup' | 'take' | 'combat';
    const records: Record<Channel, unknown> = {
      break: fixture('break-real.json').coreprotect_present,
      pickup: fixture('pickup-real.json'),
      take: fixture('take-real.json').chest_single_withdraw,
      combat: fixture('combat-real.json').kill_engaged,
    };
    const subjects: Record<Channel, string> = {
      break: BREAK_SUBJECT,
      pickup: PICKUP_SUBJECT,
      take: TAKE_SUBJECT,
      combat: COMBAT_SUBJECT,
    };
    let pairings = 0;
    for (const channel of Object.keys(subjects) as Channel[]) {
      for (const kind of Object.keys(records) as Channel[]) {
        if (kind === channel) continue;
        net.deliver(subjects[channel], JSON.stringify(records[kind]));
        pairings += 1;
      }
    }
    expect(pairings).toBe(12);
    expect(net.sub.dropped()).toEqual({ oversize: 0, malformed: 12, failed: 0 });
    expect(net.published).toEqual([]);
    net.sub.stop();
  });

  it('a take or a combat record with a bad shape is dropped as malformed and nothing is observed', () => {
    const net = setup();
    const take = fixture('take-real.json').chest_single_withdraw as Record<string, unknown>;
    net.deliver(TAKE_SUBJECT, JSON.stringify({ ...take, world: 5 }));
    net.deliver(COMBAT_SUBJECT, JSON.stringify({ kind: 'engaged', world: 5 }));
    expect(net.sub.dropped()).toEqual({ oversize: 0, malformed: 2, failed: 0 });
    expect(net.published).toEqual([]);
    net.sub.stop();
  });

  it('an oversize message is dropped unread', () => {
    const net = setup();
    const big = new Uint8Array(MAX_PROVENANCE_BYTES + 1).fill(0x20);
    net.deliver(BREAK_SUBJECT, big);
    expect(net.sub.dropped()).toEqual({ oversize: 1, malformed: 0, failed: 0 });
    expect(net.logs).toEqual(['observation: dropped a provenance message (oversize)']);
    net.sub.stop();
  });

  it('a valid break for the owner publishes one observation event', async () => {
    const net = setup();
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(1);
    const [only] = net.published;
    expect(only?.subject).toBe(`geldar.${SHARD}.observation`);
    const event = JSON.parse(only?.body ?? '{}');
    expect(event).toMatchObject({
      type: 'observation',
      agent_id: BODY,
      shard: SHARD,
      world_tick: 411,
      payload: { kind: 'property_broken', block: 'cobblestone', actor: { name: OTHER } },
    });
    expect(only?.msgId).toBe(event.source_event_id);
    net.sub.stop();
  });

  it('a break in another world gives nothing; the same world gives one', async () => {
    const net = setup();
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, world: 'world_nether' }));
    await flush();
    expect(net.published).toHaveLength(0);
    net.deliver(BREAK_SUBJECT, JSON.stringify(break_));
    await flush();
    expect(net.published).toHaveLength(1);
    net.sub.stop();
  });

  it('a break the Body cannot see gives nothing', async () => {
    const net = setup({ canSee: () => false });
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a break whose breaker is out of sight is published unattributed', async () => {
    const net = setup({ resolve: () => null });
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(1);
    const event = JSON.parse(net.published[0]?.body ?? '{}');
    expect(event.payload).not.toHaveProperty('actor');
    expect(event.payload.kind).toBe('property_broken');
    net.sub.stop();
  });

  it('a repeated break is published once', async () => {
    const net = setup();
    const body = JSON.stringify(fixture('break-real.json').coreprotect_present);
    net.deliver(BREAK_SUBJECT, body);
    net.deliver(BREAK_SUBJECT, body);
    await flush();
    expect(net.published).toHaveLength(1);
    net.sub.stop();
  });

  it('a valid pickup of the Body publishes one gift observation', async () => {
    const net = setup({
      selfName: OTHER,
      lifeId: OTHER,
      resolve: (name) => (name === BODY ? { name: BODY, life: BODY } : null),
    });
    net.deliver(PICKUP_SUBJECT, JSON.stringify(fixture('pickup-real.json')));
    await flush();
    expect(net.published).toHaveLength(1);
    const event = JSON.parse(net.published[0]?.body ?? '{}');
    expect(event.payload).toMatchObject({
      kind: 'gift_received',
      actor: { name: BODY },
      item: 'cobblestone',
      count: 4,
    });
    net.sub.stop();
  });

  it('a publish failure is logged, not thrown', async () => {
    const net = setup({
      publisher: { publish: () => Promise.reject(new Error('nats down')) },
    });
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.logs.some((line) => line.includes('not published'))).toBe(true);
    net.sub.stop();
  });

  it('a pickup in another world gives nothing; the same world gives one', async () => {
    const net = setup({
      selfName: OTHER,
      lifeId: OTHER,
      resolve: (name) => (name === BODY ? { name: BODY, life: BODY } : null),
    });
    const pickup = fixture('pickup-real.json');
    net.deliver(PICKUP_SUBJECT, JSON.stringify({ ...pickup, world: 'world_nether' }));
    await flush();
    expect(net.published).toHaveLength(0);
    net.deliver(PICKUP_SUBJECT, JSON.stringify(pickup));
    await flush();
    expect(net.published).toHaveLength(1);
    net.sub.stop();
  });

  it('a break the Body does not own gives nothing: another prior owner, or no owner', async () => {
    const net = setup();
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, prior_owner: 'ag_capc_03' }));
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_absent));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a break the Body made itself gives nothing', async () => {
    const net = setup();
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, actor: BODY }));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a pickup the Body does not receive gives nothing: another picker, or the Body threw it', async () => {
    const net = setup();
    const pickup = fixture('pickup-real.json');
    net.deliver(PICKUP_SUBJECT, JSON.stringify({ ...pickup, picker: 'ag_capc_03' }));
    net.deliver(PICKUP_SUBJECT, JSON.stringify({ ...pickup, picker: BODY, thrower: BODY }));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a message of exactly MAX_PROVENANCE_BYTES is read; one byte more is dropped', async () => {
    const net = setup();
    const json = JSON.stringify(fixture('break-real.json').coreprotect_present);
    const padded = json + ' '.repeat(MAX_PROVENANCE_BYTES - json.length);
    net.deliver(BREAK_SUBJECT, padded);
    await flush();
    expect(net.sub.dropped().oversize).toBe(0);
    expect(net.published).toHaveLength(1);
    net.deliver(BREAK_SUBJECT, `${padded} `);
    expect(net.sub.dropped()).toEqual({ oversize: 1, malformed: 0, failed: 0 });
    net.sub.stop();
  });

  it('a publisher that throws synchronously is counted as failed and does not escape', () => {
    const net = setup({
      publisher: {
        publish: () => {
          throw new Error('nats closed');
        },
      },
    });
    const body = JSON.stringify(fixture('break-real.json').coreprotect_present);
    expect(() => net.deliver(BREAK_SUBJECT, body)).not.toThrow();
    expect(net.sub.dropped()).toEqual({ oversize: 0, malformed: 0, failed: 1 });
    net.sub.stop();
  });

  it('an event the contract refuses is logged and not published', async () => {
    const net = setup({ lifeId: 'not a life id' });
    const body = JSON.stringify(fixture('break-real.json').coreprotect_present);
    net.deliver(BREAK_SUBJECT, body);
    await flush();
    expect(net.published).toHaveLength(0);
    expect(net.logs).toContain('observation: dropped an event the contract refuses');
    net.sub.stop();
  });

  it.each<[number, string[]]>([
    [2, [BREAK_SUBJECT]],
    [3, [BREAK_SUBJECT, PICKUP_SUBJECT]],
    [4, [BREAK_SUBJECT, PICKUP_SUBJECT, TAKE_SUBJECT]],
  ])(
    'a subscribe that fails at call %i unsubscribes every subscription before it and throws',
    (failAt, before) => {
      const unsubscribed: string[] = [];
      let calls = 0;
      const transport: OwnerTransport = {
        request: async () => {
          throw new Error('not used');
        },
        subscribe(subject) {
          calls += 1;
          if (calls === failAt) throw new Error('nats closed');
          return {
            unsubscribe() {
              unsubscribed.push(subject);
            },
          };
        },
      };
      expect(() => setup({ transport })).toThrow('nats closed');
      expect(unsubscribed).toEqual(before);
    },
  );
});

describe('the leakage gate at the subscription: what a published observation carries', () => {
  it('a visible breaker is named and a hidden one is unattributed; neither leaks', async () => {
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    const net = setup({
      resolve: (name) => (name === OTHER ? { name: OTHER, life: OTHER } : null),
    });
    net.deliver(BREAK_SUBJECT, JSON.stringify(break_));
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, actor: HIDDEN_LIFE, tick: 412 }));
    await flush();
    expect(net.published).toHaveLength(2);
    const [visible, hidden] = net.published.map((p) => p.body);
    expect(JSON.parse(visible ?? '{}').payload.actor).toEqual({ name: OTHER, life: OTHER });
    expect(JSON.parse(hidden ?? '{}').payload).not.toHaveProperty('actor');
    expect(JSON.parse(hidden ?? '{}').payload.key).toMatch(/:none(:|$)/);
    for (const body of [visible ?? '', hidden ?? '']) {
      expect(leaksIn(body, [BODY, OTHER])).toEqual([]);
    }
    net.sub.stop();
  });

  it('a break in a cell the Body cannot see gives nothing, even with a visible breaker', async () => {
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    const net = setup({
      canSee: () => false,
      resolve: (name) => (name === OTHER ? { name: OTHER, life: OTHER } : null),
    });
    net.deliver(BREAK_SUBJECT, JSON.stringify(break_));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a pickup names a visible thrower and not a hidden one', async () => {
    const net = setup({
      selfName: OTHER,
      lifeId: OTHER,
      resolve: (name) => (name === BODY ? { name: BODY, life: BODY } : null),
    });
    const pickup = fixture('pickup-real.json');
    net.deliver(PICKUP_SUBJECT, JSON.stringify(pickup));
    net.deliver(PICKUP_SUBJECT, JSON.stringify({ ...pickup, thrower: HIDDEN_NAME, tick: 1179 }));
    await flush();
    expect(net.published).toHaveLength(2);
    const [visible, hidden] = net.published.map((p) => p.body);
    expect(JSON.parse(visible ?? '{}').payload.actor).toEqual({ name: BODY, life: BODY });
    expect(JSON.parse(hidden ?? '{}').payload).not.toHaveProperty('actor');
    expect(JSON.parse(hidden ?? '{}').payload.key).toMatch(/:none(:|$)/);
    for (const body of [visible ?? '', hidden ?? '']) {
      expect(leaksIn(body, [OTHER, BODY])).toEqual([]);
    }
    net.sub.stop();
  });

  it('leaksIn reports each leak it scans for, one per scan, on hand-built bodies', () => {
    const body = (payload: Record<string, unknown>) => JSON.stringify({ agent_id: BODY, payload });
    const allowed = [BODY, OTHER];
    expect(leaksIn(body({ kind: 'x', note: 'a provenance record' }), allowed)).toEqual([
      'provenance',
    ]);
    expect(leaksIn(body({ kind: 'x', block: 'stone 1313 200 800' }), allowed)).toEqual([
      'coordinates',
    ]);
    expect(leaksIn(body({ kind: 'x', actor: { name: 'a', life: 'ag_capz_09' } }), allowed)).toEqual(
      ['life id ag_capz_09'],
    );
    expect(leaksIn(body({ kind: 'x', actor: { name: HIDDEN_NAME } }), allowed)).toEqual([
      'hidden actor',
    ]);
    const keyed = JSON.stringify({
      agent_id: BODY,
      payload: { kind: 'x', key: 'brk:412:1313:200:800:hidden_walker' },
    });
    expect(leaksIn(keyed, allowed)).toEqual(['hidden actor']);
    const hiddenLife = body({ kind: 'x', key: 'brk:412:1313:200:800:ag_capc_03' });
    expect(leaksIn(hiddenLife, allowed)).toContain('hidden actor');
    expect(leaksIn(body({ kind: 'x', key: 'brk:412:1313:200:800:none' }), allowed)).toEqual([]);
  });
});

// The Body's wiring (`startBodyObservations`): sight of a cell is `blockAt` plus `canSeeBlock`, and
// the world is a small set of solid cells that a ray meets in order.
const CELL = new Vec3(1313, 200, 800);
const WALL = new Vec3(1311, 200, 800);
const SIDE_WALL = new Vec3(1310, 201, 803);
/** Below `SIDE_WALL`, so no part of a body behind the two is in sight (decision 0446). */
const SIDE_WALL_LOW = new Vec3(1310, 200, 803);
const VISIBLE_BREAKER = { username: OTHER, position: new Vec3(1306, 200, 800) };
const BEHIND_WALL_BREAKER = { username: OTHER, position: new Vec3(1310, 200, 806) };

/** A world whose only solid cells are `solids`: a ray stops at the first one it passes within `range`. */
function solidWorld(solids: Vec3[]) {
  return {
    raycast: (start: Vec3, dir: Vec3, range: number) => {
      for (let t = 0; t <= range; t += 0.05) {
        const cell = start.plus(dir.scaled(t)).floored();
        const hit = solids.find((solid) => solid.equals(cell));
        if (hit) return { position: hit };
      }
      return null;
    },
  };
}

/** A Body at (1310, 200, 800) in the overworld, with the given players and solid cells. */
function bodyBot(
  opts: {
    players?: Array<{ username: string; position: Vec3 }>;
    solids?: Vec3[];
    blockAt?: (p: Vec3) => unknown;
  } = {},
): Bot {
  const entities = Object.fromEntries(
    (opts.players ?? []).map((p, i) => [
      i + 1,
      { type: 'player', username: p.username, position: p.position, height: 1.8 },
    ]),
  );
  return {
    username: BODY,
    entity: { position: new Vec3(1310, 200, 800) },
    entities,
    game: { dimension: 'minecraft:overworld' },
    time: { age: 411 },
    world: solidWorld(opts.solids ?? [CELL]),
    blockAt: opts.blockAt ?? ((p: Vec3) => ({ position: p, name: 'cobblestone' })),
  } as unknown as Bot;
}

function bodyNet(bot: Bot) {
  const net = fakeTransport();
  const published: string[] = [];
  const logs: string[] = [];
  const sub = startBodyObservations({
    transport: net.transport,
    shard: SHARD,
    lifeId: BODY,
    bot,
    publisher: {
      publish: async (_subject, body) => {
        published.push(body);
      },
    },
    log: (line) => logs.push(line),
  });
  return { ...net, sub, published, logs };
}

describe('startBodyObservations (AN-28b wiring)', () => {
  it('a break is observed when the Body sees its cell: blockAt gets the cell as a Vec3 and the visible breaker is named', async () => {
    const blockAt = vi.fn((p: Vec3) => ({ position: p, name: 'cobblestone' }));
    const net = bodyNet(bodyBot({ players: [VISIBLE_BREAKER], blockAt }));
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(blockAt).toHaveBeenCalledWith(CELL);
    expect(net.published).toHaveLength(1);
    expect(JSON.parse(net.published[0] ?? '{}').payload.actor).toMatchObject({ name: OTHER });
    net.sub.stop();
  });

  it('a break in a cell behind another block gives nothing, even with a visible breaker', async () => {
    const net = bodyNet(bodyBot({ players: [VISIBLE_BREAKER], solids: [CELL, WALL] }));
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('a break with no block at its cell gives nothing', async () => {
    const net = bodyNet(bodyBot({ players: [VISIBLE_BREAKER], blockAt: () => null }));
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(0);
    net.sub.stop();
  });

  it('selfName is the life id: a break whose prior owner is this Body is observed, another owner is not', async () => {
    const net = bodyNet(bodyBot({ players: [VISIBLE_BREAKER] }));
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    net.deliver(BREAK_SUBJECT, JSON.stringify(break_));
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, prior_owner: OTHER, tick: 412 }));
    await flush();
    expect(net.published).toHaveLength(1);
    expect(JSON.parse(net.published[0] ?? '{}').agent_id).toBe(BODY);
    net.sub.stop();
  });

  it('a breaker the Body cannot see is not named: the cell is in sight, the observation has no actor', async () => {
    const net = bodyNet(
      bodyBot({ players: [BEHIND_WALL_BREAKER], solids: [CELL, SIDE_WALL, SIDE_WALL_LOW] }),
    );
    net.deliver(BREAK_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    await flush();
    expect(net.published).toHaveLength(1);
    expect(JSON.parse(net.published[0] ?? '{}').payload).not.toHaveProperty('actor');
    net.sub.stop();
  });
});
