import { readFileSync } from 'node:fs';
import { provenanceBreakSubject, provenancePickupSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { OwnerTransport } from '../../body/block-owners.ts';
import type { EventPublisher } from '../../body/records-nats.ts';
import { MAX_PROVENANCE_BYTES, type ObservationOptions, startObservations } from './subscribe.ts';

const SHARD = 'phase0';
const BODY = 'ag_capa_01';
const OTHER = 'ag_capb_02';
const BREAK_SUBJECT = provenanceBreakSubject(SHARD);
const PICKUP_SUBJECT = provenancePickupSubject(SHARD);

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
  it('observations on: both subjects subscribed and stop unsubscribes both', () => {
    const net = setup();
    expect(net.subs.map((s) => s.subject)).toEqual([BREAK_SUBJECT, PICKUP_SUBJECT]);
    net.sub.stop();
    expect(net.subs.map((s) => s.unsubscribed)).toEqual([true, true]);
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

  it('a message of the wrong kind for its subject is dropped as malformed', () => {
    const net = setup();
    net.deliver(PICKUP_SUBJECT, JSON.stringify(fixture('break-real.json').coreprotect_present));
    expect(net.sub.dropped().malformed).toBe(1);
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

  it('a subscribe that fails after the first unsubscribes the first and throws', () => {
    const unsubscribed: string[] = [];
    let calls = 0;
    const transport: OwnerTransport = {
      request: async () => {
        throw new Error('not used');
      },
      subscribe(subject) {
        calls += 1;
        if (calls === 2) throw new Error('nats closed');
        return {
          unsubscribe() {
            unsubscribed.push(subject);
          },
        };
      },
    };
    expect(() => setup({ transport })).toThrow('nats closed');
    expect(unsubscribed).toEqual([BREAK_SUBJECT]);
  });
});

/** A life id and a username that must never reach a published body when the actor is out of sight. */
const HIDDEN_LIFE = 'ag_capc_03';
const HIDDEN_NAME = 'Hidden_Walker';

/**
 * The leaks in one published observation. The payload's `key` is the contract's dedupe key and is
 * scanned by the Mind's presenter (threshold leakage gate), so it is set aside here.
 */
function leaksIn(body: string, allowedIds: string[]): string[] {
  const event = JSON.parse(body) as { payload: Record<string, unknown> };
  const shown = JSON.stringify({ ...event.payload, key: undefined });
  const leaks: string[] = [];
  if (/provenance/i.test(body)) leaks.push('provenance');
  if (/\b\d{2,}\b\D{1,3}\b\d{2,}\b\D{1,3}\b\d{2,}\b/.test(shown)) leaks.push('coordinates');
  for (const id of shown.match(/ag_[a-z0-9_]+/g) ?? []) {
    if (!allowedIds.includes(id)) leaks.push(`life id ${id}`);
  }
  if (body.includes(HIDDEN_NAME) || body.includes(HIDDEN_LIFE)) leaks.push('hidden actor');
  return leaks;
}

describe('the leakage gate at the subscription: what a published observation carries', () => {
  it('a visible breaker is named and a hidden one is unattributed; neither leaks', async () => {
    const break_ = fixture('break-real.json').coreprotect_present as Record<string, unknown>;
    const net = setup({
      resolve: (name) => (name === OTHER ? { name: OTHER, life: OTHER } : null),
    });
    net.deliver(BREAK_SUBJECT, JSON.stringify(break_));
    net.deliver(BREAK_SUBJECT, JSON.stringify({ ...break_, actor: HIDDEN_NAME, tick: 412 }));
    await flush();
    expect(net.published).toHaveLength(2);
    const [visible, hidden] = net.published.map((p) => p.body);
    expect(JSON.parse(visible ?? '{}').payload.actor).toEqual({ name: OTHER, life: OTHER });
    expect(JSON.parse(hidden ?? '{}').payload).not.toHaveProperty('actor');
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
    for (const body of [visible ?? '', hidden ?? '']) {
      expect(leaksIn(body, [OTHER, BODY])).toEqual([]);
    }
    net.sub.stop();
  });
});
