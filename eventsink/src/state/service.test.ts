import { type ProficiencyState, validateProficiencyState } from '@geldar/contract';
import { type Domain, levelForXp, STANDARD_SHEET } from '@geldar/psyche';
import type { NatsConnection } from '@nats-io/transport-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proficiencyRequestSubject, stateWildcard } from '../../../contract/src/subjects.ts';
import { Limiter, type StateStore, serveProficiencyState } from './service.ts';

// The service against a fake NATS connection and an in-memory store. The fake delivers every subject to
// every subscription and does no matching of its own, so the service's own subject checks are what refuse
// a bad subject. Real NATS roles and the database are covered by eventsink/test/state.it.test.ts.

const SHARD = 'phase0';
const LIFE = 'ag_kestrel_01';
const OTHER = 'ag_falcon_02';
const QUEUE = 'state-service';
const T = [10, 30, 70] as const;
const DOMAINS: Domain[] = [
  'combat',
  'farming',
  'mining',
  'building',
  'crafting',
  'exploring',
  'social',
];
const ZERO = { level: 0, xp: 0 };
const HASH = 'a'.repeat(64);

type Msg = { subject: string; data: Uint8Array; respond(data?: Uint8Array): boolean };

class FakeSub implements AsyncIterable<Msg> {
  readonly subject: string;

  constructor(subject: string) {
    this.subject = subject;
  }

  readonly #queue: Msg[] = [];
  #waiter: { resolve(r: IteratorResult<Msg>): void; reject(e: unknown): void } | undefined;
  #closed: { error: Error | undefined } | undefined;

  deliver(m: Msg): void {
    const w = this.#waiter;
    if (w) {
      this.#waiter = undefined;
      w.resolve({ value: m, done: false });
    } else {
      this.#queue.push(m);
    }
  }

  // Ends the iterator: with an error it rejects (as a server permissions violation does), else it is done.
  close(error?: Error): void {
    this.#closed = { error };
    const w = this.#waiter;
    if (!w) return;
    this.#waiter = undefined;
    if (error) w.reject(error);
    else w.resolve({ value: undefined, done: true });
  }

  unsubscribe(): void {
    this.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<Msg> {
    return {
      next: (): Promise<IteratorResult<Msg>> => {
        const m = this.#queue.shift();
        if (m) return Promise.resolve({ value: m, done: false });
        if (this.#closed) {
          const error = this.#closed.error;
          return error ? Promise.reject(error) : Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => {
          this.#waiter = { resolve, reject };
        });
      },
    };
  }
}

class FakeNats {
  readonly subs: FakeSub[] = [];
  readonly opts: ({ queue?: string } | undefined)[] = [];
  readonly replies: string[] = [];
  // While above zero, subscribe throws synchronously (a refused subscription), counting down.
  refusals = 0;

  subscribe(subject: string, opts?: { queue?: string }): FakeSub {
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new Error('Permissions Violation for Subscription');
    }
    const sub = new FakeSub(subject);
    this.subs.push(sub);
    this.opts.push(opts);
    return sub;
  }

  send(subject: string, body = ''): void {
    const data = new TextEncoder().encode(body);
    for (const sub of this.subs) {
      sub.deliver({
        subject,
        data,
        respond: (out) => {
          this.replies.push(new TextDecoder().decode(out ?? new Uint8Array()));
          return true;
        },
      });
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Sends one request and returns the replies it produced. Ten milliseconds is enough for the sequential loop.
async function ask(nats: FakeNats, subject: string, body = ''): Promise<string[]> {
  const before = nats.replies.length;
  nats.send(subject, body);
  await sleep(10);
  return nats.replies.slice(before);
}

// The one reply of a request; a request that got none fails here, not later on an undefined read.
function first(replies: string[]): string {
  const reply = replies[0];
  if (reply === undefined) throw new Error('no reply');
  return reply;
}

// Fails the test if an unhandled rejection happens while `run` executes.
async function noUnhandled(run: () => Promise<void>): Promise<void> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    await run();
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  expect(seen).toEqual([]);
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function levelsOf(xp: Partial<Record<Domain, number>>): ProficiencyState['levels'] {
  const out = {} as ProficiencyState['levels'];
  for (const d of DOMAINS) {
    const x = xp[d] ?? 0;
    out[d] = { level: levelForXp(x, T), xp: x };
  }
  return out;
}

function stored(
  life: string,
  xp: Partial<Record<Domain, number>>,
  // `extra` models columns a store row might carry beyond the state (a sheet): the service must not reply them.
  extra: Record<string, unknown> = {},
): ProficiencyState {
  return { life_id: life, version: 0, levels: levelsOf(xp), ...extra } as ProficiencyState;
}

function fixture(rows: Map<string, ProficiencyState | null>): {
  store: StateStore;
  calls: string[];
} {
  const calls: string[] = [];
  const store: StateStore = {
    read: async (id) => {
      calls.push(id);
      return rows.get(id) ?? null;
    },
  };
  return { store, calls };
}

type Extra = {
  minIntervalMs?: number;
  readTimeoutMs?: number;
  retryBaseMs?: number;
  log?: (l: string) => void;
};

function serve(
  store: StateStore,
  extra: Extra = {},
  nats = new FakeNats(),
): { nats: FakeNats; svc: { stop(): Promise<void> } } {
  const svc = serveProficiencyState({
    nc: nats as unknown as NatsConnection,
    store,
    shard: SHARD,
    log: extra.log ?? (() => undefined),
    minIntervalMs: extra.minIntervalMs ?? 0,
    readTimeoutMs: extra.readTimeoutMs ?? 2000,
    retryBaseMs: extra.retryBaseMs ?? 1,
    thresholds: T,
  });
  return { nats, svc };
}

const subjectOf = (life: string) => proficiencyRequestSubject(SHARD, life);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proficiency state service: the reply', () => {
  it('replies with the life own levels and version, never the sheet', async () => {
    const rows = new Map([
      [LIFE, stored(LIFE, { combat: 5, mining: 40 }, { sheet: STANDARD_SHEET, sheet_hash: HASH })],
    ]);
    const { store } = fixture(rows);
    const { nats, svc } = serve(store);
    const reply = first(await ask(nats, subjectOf(LIFE)));
    expect(JSON.parse(reply)).toEqual({
      life_id: LIFE,
      version: 45,
      levels: {
        combat: { level: 0, xp: 5 },
        farming: ZERO,
        mining: { level: 2, xp: 40 },
        building: ZERO,
        crafting: ZERO,
        exploring: ZERO,
        social: ZERO,
      },
    });
    expect(reply).not.toContain('sheet');
    await svc.stop();
  });

  it('replies with zeros and version 0 for a life with no rows', async () => {
    const rows = new Map([[LIFE, stored(LIFE, {})]]);
    const { nats, svc } = serve(fixture(rows).store);
    const body = JSON.parse(first(await ask(nats, subjectOf(LIFE))));
    expect(body).toEqual({
      life_id: LIFE,
      version: 0,
      levels: Object.fromEntries(DOMAINS.map((d) => [d, ZERO])),
    });
    expect(body).not.toHaveProperty('sheet');
    expect(body).not.toHaveProperty('sheet_hash');
    await svc.stop();
  });

  it('answers the not-found shape for a life with no agents row', async () => {
    const { store, calls } = fixture(new Map());
    const { nats, svc } = serve(store);
    expect(await ask(nats, subjectOf(LIFE))).toEqual(['{"error":"unknown_life"}']);
    expect(calls).toEqual([LIFE]);
    await svc.stop();
  });

  it('version is strictly monotonic with XP', async () => {
    const rows = new Map([[LIFE, stored(LIFE, { mining: 10 })]]);
    const { store } = fixture(rows);
    const { nats, svc } = serve(store);
    const v1 = JSON.parse(first(await ask(nats, subjectOf(LIFE)))).version;
    rows.set(LIFE, stored(LIFE, { mining: 11 }));
    const v2 = JSON.parse(first(await ask(nats, subjectOf(LIFE)))).version;
    rows.set(LIFE, stored(LIFE, { mining: 11, combat: 1 }));
    const v3 = JSON.parse(first(await ask(nats, subjectOf(LIFE)))).version;
    expect([v1, v2, v3]).toEqual([10, 11, 12]);
    await svc.stop();
  });

  it('version is the sum of the XP, not the row count, and the store version is ignored', async () => {
    // Three domains with XP 5, 10 and 20: the sum is 35, the domain count is 3.
    const rows = new Map([
      [LIFE, stored(LIFE, { combat: 5, mining: 10, social: 20 }, { version: 999 })],
    ]);
    const { nats, svc } = serve(fixture(rows).store);
    const body = JSON.parse(first(await ask(nats, subjectOf(LIFE))));
    expect(body.version).toBe(35);
    await svc.stop();
  });
});

describe('proficiency state service: the authority and the refusals', () => {
  it('reply with another life data is refused, and the reason is logged', async () => {
    const leak = { read: async () => stored(OTHER, { combat: 9 }) };
    const lines: string[] = [];
    const { nats, svc } = serve(leak, { log: (l) => lines.push(l) });
    const replies = await ask(nats, subjectOf(LIFE));
    expect(replies).toEqual(['{"error":"unavailable"}']);
    expect(replies.join('')).not.toContain('9');
    expect(lines).toEqual(['state life mismatch']);
    await svc.stop();
  });

  it('trust payload life id: the subject life is the only authority', async () => {
    const rows = new Map([
      [LIFE, stored(LIFE, { mining: 1 })],
      [OTHER, stored(OTHER, { combat: 9 })],
    ]);
    const { store, calls } = fixture(rows);
    const { nats, svc } = serve(store);
    const reply = first(await ask(nats, subjectOf(LIFE), JSON.stringify({ life_id: OTHER })));
    expect(calls).toEqual([LIFE]);
    expect(JSON.parse(reply).life_id).toBe(LIFE);
    await svc.stop();
  });

  it('a stored level that does not match its XP is refused', async () => {
    const bad = stored(LIFE, { mining: 5 });
    bad.levels.mining = { level: 3, xp: 5 };
    const lines: string[] = [];
    const { nats, svc } = serve(fixture(new Map([[LIFE, bad]])).store, {
      log: (l) => lines.push(l),
    });
    expect(await ask(nats, subjectOf(LIFE))).toEqual(['{"error":"unavailable"}']);
    expect(lines).toEqual(['state level mismatch']);
    await svc.stop();
  });

  it('reply validates against the contract, even when the row holds a sheet', async () => {
    const withSheet = stored(LIFE, { mining: 5 }, { sheet: STANDARD_SHEET, sheet_hash: 'not-hex' });
    const { nats, svc } = serve(fixture(new Map([[LIFE, withSheet]])).store);
    const reply = JSON.parse(first(await ask(nats, subjectOf(LIFE))));
    expect(validateProficiencyState(reply).ok).toBe(true);
    expect(reply).not.toHaveProperty('sheet');
    await svc.stop();
  });

  it('a store error answers unavailable and logs a reason only', async () => {
    const failing: StateStore = {
      read: async () => {
        throw new Error('connection refused at the state host');
      },
    };
    const lines: string[] = [];
    const { nats, svc } = serve(failing, { log: (l) => lines.push(l) });
    expect(await ask(nats, subjectOf(LIFE))).toEqual(['{"error":"unavailable"}']);
    expect(lines).toEqual(['state read failed']);
    await svc.stop();
  });

  it('a body over 256 bytes gets no reply and no read; 256 bytes is answered', async () => {
    const rows = new Map([[LIFE, stored(LIFE, {})]]);
    const { store, calls } = fixture(rows);
    const { nats, svc } = serve(store);
    expect(await ask(nats, subjectOf(LIFE), 'x'.repeat(257))).toEqual([]);
    expect(calls).toEqual([]);
    expect(await ask(nats, subjectOf(LIFE), 'x'.repeat(256))).toHaveLength(1);
    await svc.stop();
  });
});

describe('proficiency state service: the subject checks, run by the service itself', () => {
  it('a subject for another shard, or a different prefix, gets no reply and no read', async () => {
    const { store, calls } = fixture(new Map([[LIFE, stored(LIFE, {})]]));
    const { nats, svc } = serve(store);
    expect(await ask(nats, `geldar.other-shard.state.${LIFE}.proficiency`)).toEqual([]);
    expect(await ask(nats, `xgeldar.${SHARD}.state.${LIFE}.proficiency`)).toEqual([]);
    expect(calls).toEqual([]);
    await svc.stop();
  });

  it('a subject with a malformed life token gets no reply and no read', async () => {
    const { store, calls } = fixture(new Map([[LIFE, stored(LIFE, {})]]));
    const { nats, svc } = serve(store);
    expect(await ask(nats, `geldar.${SHARD}.state.AG.proficiency`)).toEqual([]);
    expect(calls).toEqual([]);
    await svc.stop();
  });

  it('a subject with five tokens too many or too few gets no reply and no read', async () => {
    const { store, calls } = fixture(new Map([[LIFE, stored(LIFE, {})]]));
    const { nats, svc } = serve(store);
    // Six tokens, with the fifth one `proficiency`: only the token count refuses it.
    expect(await ask(nats, `geldar.${SHARD}.state.${LIFE}.proficiency.extra`)).toEqual([]);
    expect(await ask(nats, `geldar.${SHARD}.state.proficiency`)).toEqual([]);
    expect(calls).toEqual([]);
    await svc.stop();
  });

  it('a one-digit life id is refused by the contract and by the service; two digits are answered', async () => {
    expect(() => proficiencyRequestSubject(SHARD, 'ag_x_1')).toThrow();
    expect(proficiencyRequestSubject(SHARD, 'ag_x_01')).toBe(
      `geldar.${SHARD}.state.ag_x_01.proficiency`,
    );
    const rows = new Map([
      ['ag_x_1', stored('ag_x_1', {})],
      ['ag_x_01', stored('ag_x_01', {})],
    ]);
    const { store, calls } = fixture(rows);
    const { nats, svc } = serve(store);
    expect(await ask(nats, `geldar.${SHARD}.state.ag_x_1.proficiency`)).toEqual([]);
    expect(calls).toEqual([]);
    expect(
      JSON.parse(first(await ask(nats, `geldar.${SHARD}.state.ag_x_01.proficiency`))).life_id,
    ).toBe('ag_x_01');
    expect(calls).toEqual(['ag_x_01']);
    await svc.stop();
  });
});

describe('proficiency state service: the limiter', () => {
  it('the map never exceeds its cap under a spread of distinct lives', () => {
    const lim = new Limiter(1000);
    let max = 0;
    for (let i = 0; i < 20_000; i++) {
      lim.allow(`ag_k_${String(i).padStart(6, '0')}`, 0);
      max = Math.max(max, lim.size);
    }
    expect(max).toBe(4096);
    expect(lim.size).toBe(4096);
  });

  it('the last allowed entry (4096th life) is held without evicting anyone', () => {
    const lim = new Limiter(1000);
    for (let i = 0; i < 4095; i++) lim.allow(`ag_k_${i}_01`, 0);
    expect(lim.allow('ag_k_last_01', 0)).toBe(true);
    expect(lim.size).toBe(4096);
    expect(lim.allow('ag_k_0_01', 500)).toBe(false); // still held: inside the interval
  });

  it('past the cap a new life evicts the oldest entry, which is then admitted again', () => {
    const lim = new Limiter(1000);
    for (let i = 0; i < 4096; i++) lim.allow(`ag_k_${i}_01`, 0);
    expect(lim.allow('ag_new_01', 0)).toBe(true);
    expect(lim.size).toBe(4096);
    expect(lim.allow('ag_k_0_01', 0)).toBe(true); // evicted, so no slot is held
    expect(lim.allow('ag_k_4095_01', 0)).toBe(false); // newer entries are still held
  });
});

describe('proficiency state service: rate, reads, close and wiring', () => {
  it('a request inside the minimum interval gets the rate error, per life', async () => {
    const rows = new Map([
      [LIFE, stored(LIFE, { mining: 1 })],
      [OTHER, stored(OTHER, { combat: 1 })],
    ]);
    const { store, calls } = fixture(rows);
    const { nats, svc } = serve(store, { minIntervalMs: 1000 });
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000_000);
    expect(JSON.parse(first(await ask(nats, subjectOf(LIFE)))).life_id).toBe(LIFE);
    now.mockReturnValue(1_000_500);
    expect(await ask(nats, subjectOf(LIFE))).toEqual(['{"error":"rate"}']);
    expect(JSON.parse(first(await ask(nats, subjectOf(OTHER)))).life_id).toBe(OTHER);
    expect(calls).toEqual([LIFE, OTHER]);
    now.mockReturnValue(1_001_000);
    expect(JSON.parse(first(await ask(nats, subjectOf(LIFE)))).life_id).toBe(LIFE);
    await svc.stop();
  });

  it('a read that never settles answers unavailable, and the next life is not stalled', async () => {
    const store: StateStore = {
      read: (id) =>
        id === LIFE ? new Promise(() => undefined) : Promise.resolve(stored(OTHER, { combat: 1 })),
    };
    const lines: string[] = [];
    const { nats, svc } = serve(store, { readTimeoutMs: 5, log: (l) => lines.push(l) });
    expect(await ask(nats, subjectOf(LIFE))).toEqual(['{"error":"unavailable"}']);
    expect(JSON.parse(first(await ask(nats, subjectOf(OTHER)))).life_id).toBe(OTHER);
    expect(lines).toEqual(['state read failed']);
    await noUnhandled(() => svc.stop());
  });

  it('stop resolves while a read never settles, and sends no late reply', async () => {
    const store: StateStore = { read: () => new Promise(() => undefined) };
    const { nats, svc } = serve(store, { readTimeoutMs: 30 });
    nats.send(subjectOf(LIFE));
    await sleep(5);
    await svc.stop();
    expect(nats.replies).toEqual([]);
  });

  it('a reply that is ready after stop is called is not sent', async () => {
    const gate = deferred<ProficiencyState | null>();
    const { nats, svc } = serve({ read: () => gate.promise }, { readTimeoutMs: 5000 });
    nats.send(subjectOf(LIFE));
    await sleep(5);
    const stopping = svc.stop();
    gate.resolve(stored(LIFE, { mining: 1 }));
    await stopping;
    expect(nats.replies).toEqual([]);
  });

  it('stop ends the subscription: a request after stop gets no reply', async () => {
    const { store } = fixture(new Map([[LIFE, stored(LIFE, {})]]));
    const { nats, svc } = serve(store);
    await svc.stop();
    expect(await ask(nats, subjectOf(LIFE))).toEqual([]);
  });

  it('subscribes in the state queue group, so two sinks do not both reply', () => {
    const { nats, svc } = serve(fixture(new Map()).store);
    expect(nats.opts[0]).toEqual({ queue: QUEUE });
    void svc.stop();
  });

  it('a refused subscription is logged, retried, and the service answers after it recovers', async () => {
    const lines: string[] = [];
    const nats = new FakeNats();
    nats.refusals = 2;
    const { store } = fixture(new Map([[LIFE, stored(LIFE, { mining: 1 })]]));
    const { svc } = serve(store, { log: (l) => lines.push(l) }, nats);
    await noUnhandled(async () => {
      await sleep(30);
      expect(lines.filter((l) => l === 'state subscription failed')).toHaveLength(2);
      expect(JSON.parse(first(await ask(nats, subjectOf(LIFE)))).life_id).toBe(LIFE);
    });
    expect(lines.join('\n')).not.toContain('Permissions');
    await svc.stop();
  });

  it('a subscription whose iterator rejects is logged once, resubscribed, and does not reject unhandled', async () => {
    const lines: string[] = [];
    const { nats, svc } = serve(fixture(new Map([[LIFE, stored(LIFE, { mining: 1 })]])).store, {
      log: (l) => lines.push(l),
    });
    await noUnhandled(async () => {
      nats.subs[0]?.close(
        new Error('Permissions Violation for Subscription to geldar.phase0.state.>'),
      );
      await sleep(30);
      expect(nats.subs.length).toBe(2);
      expect(lines.filter((l) => l === 'state subscription failed')).toHaveLength(1);
      expect(JSON.parse(first(await ask(nats, subjectOf(LIFE)))).life_id).toBe(LIFE);
    });
    expect(lines.join('\n')).not.toContain('Permissions');
    await svc.stop();
  });

  it('a subscription that ends without an error is logged and resubscribed', async () => {
    const lines: string[] = [];
    const { nats, svc } = serve(fixture(new Map([[LIFE, stored(LIFE, {})]])).store, {
      log: (l) => lines.push(l),
    });
    nats.subs[0]?.close();
    await sleep(30);
    expect(lines).toContain('state subscription ended');
    expect(nats.subs.length).toBe(2);
    await svc.stop();
  });

  it('stop ends a retry that is waiting out its backoff, without waiting for it', async () => {
    const nats = new FakeNats();
    nats.refusals = Number.POSITIVE_INFINITY;
    const { svc } = serve(fixture(new Map()).store, { retryBaseMs: 60_000 }, nats);
    await sleep(5);
    const started = Date.now();
    await svc.stop();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses a shard name the contract refuses, and a bad threshold or read timeout', () => {
    const nats = new FakeNats() as unknown as NatsConnection;
    const base = { nc: nats, store: fixture(new Map()).store, log: () => undefined };
    expect(() => serveProficiencyState({ ...base, shard: 'Bad_Shard' })).toThrow(RangeError);
    expect(() =>
      serveProficiencyState({ ...base, shard: SHARD, thresholds: [30, 10, 70] }),
    ).toThrow(RangeError);
    expect(() => serveProficiencyState({ ...base, shard: SHARD, readTimeoutMs: 0 })).toThrow(
      RangeError,
    );
  });

  it('the subject it answers is the contract request subject, inside the state wildcard', () => {
    const nats = new FakeNats();
    const svc = serveProficiencyState({
      nc: nats as unknown as NatsConnection,
      store: fixture(new Map()).store,
      shard: SHARD,
      log: () => undefined,
    });
    expect(nats.subs[0]?.subject).toBe(`geldar.${SHARD}.state.*.proficiency`);
    expect(subjectOf(LIFE)).toBe(`geldar.${SHARD}.state.${LIFE}.proficiency`);
    expect(stateWildcard(SHARD)).toBe(`geldar.${SHARD}.state.>`);
    void svc.stop();
  });
});
