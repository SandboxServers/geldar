import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proficiencyPushSubject } from '../../../contract/src/subjects.ts';
import { type LevelPush, retryDelayMs, startOutboxPublisher } from './outbox.ts';

// An in-memory stand-in for proficiency_outbox and agents. Transactions stage their marks and apply them on
// COMMIT, so a failed COMMIT or a ROLLBACK leaves the rows unpublished, as Postgres does. ORDER BY is honoured
// only when the SQL names it, so a removed ORDER BY shows up as out-of-order pushes.
interface Row {
  outbox_id: number;
  life_id: string;
  domain: string;
  level: number;
  xp: number;
  version: number;
  shard: string;
  published: boolean;
}

interface Sent {
  subject: string;
  body: string;
}

function fakeOutbox(rows: Omit<Row, 'published'>[]) {
  const committed: Row[] = rows.map((r) => ({ ...r, published: false }));
  let staged: number[] = [];
  let failNextCommit = false;
  let failNextRollback = false;
  let connects = 0;
  const logs: string[] = [];
  const sent: Sent[] = [];
  const sqls: string[] = [];
  const released: unknown[] = [];

  const query = (sql: string, params: unknown[] = []): { rows: unknown[] } => {
    sqls.push(sql);
    if (sql === 'BEGIN') {
      staged = [];
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('commit failed');
      }
      for (const row of committed) if (staged.includes(row.outbox_id)) row.published = true;
      staged = [];
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      if (failNextRollback) {
        failNextRollback = false;
        throw new Error('rollback failed');
      }
      staged = [];
      return { rows: [] };
    }
    if (sql.includes('FROM proficiency_outbox o JOIN agents')) {
      const [limit, rejected] = params as [number, number[]];
      let rows = committed.filter((r) => !r.published && !rejected.includes(r.outbox_id));
      if (/ORDER BY o\.outbox_id/.test(sql))
        rows = [...rows].sort((a, b) => a.outbox_id - b.outbox_id);
      return {
        rows: rows.slice(0, limit).map((r) => {
          const published = committed.filter(
            (p) => p.published && p.life_id === r.life_id && p.domain === r.domain,
          );
          const top = published.length
            ? String(Math.max(...published.map((p) => p.version)))
            : null;
          return {
            outbox_id: String(r.outbox_id),
            life_id: r.life_id,
            domain: r.domain,
            level: r.level,
            xp: r.xp,
            version: String(r.version),
            shard: r.shard,
            published_version: top,
          };
        }),
      };
    }
    if (sql.startsWith('UPDATE proficiency_outbox')) {
      staged.push(...(params[0] as number[]));
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };

  const client = {
    query: async (sql: string, params?: unknown[]) => query(sql, params),
    release: (err?: unknown) => {
      released.push(err);
    },
  };
  const pool = {
    connect: async () => {
      connects++;
      return client;
    },
  } as unknown as Pool;

  const push: LevelPush = {
    publish(subject, body) {
      sent.push({ subject, body });
    },
  };

  return {
    pool,
    push,
    sent,
    logs,
    committed,
    released,
    sqls,
    connects: () => connects,
    failNextCommit: () => {
      failNextCommit = true;
    },
    failNextRollback: () => {
      failNextRollback = true;
    },
    publishedIds: () => committed.filter((r) => r.published).map((r) => r.outbox_id),
    log: (l: string) => logs.push(l),
  };
}

const LIFE = 'ag_kestrel_01';

function row(
  outbox_id: number,
  over: Partial<Omit<Row, 'published'>> = {},
): Omit<Row, 'published'> {
  return {
    outbox_id,
    life_id: LIFE,
    domain: 'mining',
    level: 1,
    xp: 10,
    version: 10,
    shard: 'colo',
    ...over,
  };
}

function publisher(db: ReturnType<typeof fakeOutbox>, batch = 100) {
  return startOutboxPublisher({
    pool: db.pool,
    push: db.push,
    intervalMs: 3_600_000,
    batch,
    log: db.log,
  });
}

describe('level outbox publisher (unit)', () => {
  it('publishes the level payload on geldar.<shard>.state.<life>.level and marks the row', async () => {
    const db = fakeOutbox([row(1)]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(1);
    expect(db.sent).toEqual([
      {
        subject: `geldar.colo.state.${LIFE}.level`,
        body: JSON.stringify({ life_id: LIFE, domain: 'mining', level: 1, xp: 10, version: 10 }),
      },
    ]);
    expect(db.publishedIds()).toEqual([1]);
    await p.stop();
  });

  it('publishes in outbox_id order even when the rows are stored out of order', async () => {
    const db = fakeOutbox([
      row(3, { version: 30 }),
      row(1, { version: 10 }),
      row(2, { version: 20 }),
    ]);
    const p = publisher(db);
    await p.drainOnce();
    expect(db.sent.map((s) => JSON.parse(s.body).version)).toEqual([10, 20, 30]);
    await p.stop();
  });

  it('collapses a stale row: a version below one already published for the same life and domain is not pushed', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    const p = publisher(db);
    await p.drainOnce();
    db.committed.push({ ...row(2, { version: 9, level: 1 }), published: false });
    expect(await p.drainOnce()).toBe(0);
    expect(db.sent.map((s) => JSON.parse(s.body).version)).toEqual([10]);
    expect(db.publishedIds()).toEqual([1, 2]);
    await p.stop();
  });

  it('a stale row inside one batch is collapsed after the higher version it follows', async () => {
    const db = fakeOutbox([row(1, { version: 20 }), row(2, { version: 15 })]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(1);
    expect(db.sent.map((s) => JSON.parse(s.body).version)).toEqual([20]);
    expect(db.publishedIds()).toEqual([1, 2]);
    await p.stop();
  });

  it('an equal version is published again (duplicates are tolerated)', async () => {
    const db = fakeOutbox([row(1, { version: 10 }), row(2, { version: 10, level: 2 })]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(2);
    await p.stop();
  });

  it('a failed push leaves the row unpublished and stops the pass; the next pass publishes it', async () => {
    const db = fakeOutbox([row(1, { version: 10 }), row(2, { version: 11 })]);
    let fail = true;
    const p = startOutboxPublisher({
      pool: db.pool,
      push: {
        publish(subject, body) {
          if (fail) throw new Error('nats down');
          db.push.publish(subject, body);
        },
      },
      intervalMs: 3_600_000,
      log: db.log,
    });
    expect(await p.drainOnce()).toBe(0);
    expect(db.publishedIds()).toEqual([]);
    fail = false;
    expect(await p.drainOnce()).toBe(2);
    expect(db.sent.map((s) => JSON.parse(s.body).version)).toEqual([10, 11]);
    await p.stop();
  });

  it('a push that dies after the send is repeated on the next pass (at least once)', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    let crash = true;
    const p = startOutboxPublisher({
      pool: db.pool,
      push: {
        publish(subject, body) {
          db.push.publish(subject, body);
          if (crash) throw new Error('crash after send');
        },
      },
      intervalMs: 3_600_000,
      log: db.log,
    });
    await p.drainOnce();
    crash = false;
    expect(await p.drainOnce()).toBe(1);
    expect(db.sent).toHaveLength(2);
    expect(db.publishedIds()).toEqual([1]);
    await p.stop();
  });

  it('a failed commit rolls back the marks, so the rows are published again', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    const p = publisher(db);
    db.failNextCommit();
    await expect(p.drainOnce()).rejects.toThrow('commit failed');
    expect(db.publishedIds()).toEqual([]);
    expect(await p.drainOnce()).toBe(1);
    await p.stop();
  });

  it('a failed ROLLBACK does not mask the error that caused it, and the client is released with that error', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    const p = publisher(db);
    db.failNextCommit();
    db.failNextRollback();
    await expect(p.drainOnce()).rejects.toThrow('commit failed');
    expect(db.released).toHaveLength(1);
    expect((db.released[0] as Error).message).toBe('commit failed');
    expect(db.publishedIds()).toEqual([]);
    await p.stop();
  });

  it('a healthy pass releases its client without an error, so the client goes back to the pool', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(1);
    expect(db.released).toEqual([undefined]);
    await p.stop();
  });

  it('the claim locks only the outbox row, skips locked rows, and is ordered by outbox_id', async () => {
    const db = fakeOutbox([row(1, { version: 10 })]);
    const p = publisher(db);
    await p.drainOnce();
    const claim = db.sqls.find((s) => s.includes('FROM proficiency_outbox o JOIN agents'));
    expect(claim).toMatch(/ORDER BY o\.outbox_id LIMIT \$1\s+FOR UPDATE OF o SKIP LOCKED$/);
    await p.stop();
  });

  it('a row failing the contract is logged, left unpublished and not deleted; later rows still go out', async () => {
    const db = fakeOutbox([
      row(1, { domain: 'bogus' }),
      row(2, { version: 11 }),
      row(3, { shard: 'bad.shard', version: 12 }),
    ]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(1);
    expect(db.publishedIds()).toEqual([2]);
    expect(db.committed.some((r) => r.outbox_id === 1)).toBe(true);
    expect(db.logs).toEqual([
      'outbox_rejected outbox_id=1 total=1',
      'outbox_rejected outbox_id=3 total=2',
    ]);
    await p.drainOnce();
    expect(db.logs).toHaveLength(2);
    await p.stop();
  });

  it('stop ends the loop: no connection is taken after stop resolves', async () => {
    const db = fakeOutbox([row(1)]);
    const p = startOutboxPublisher({ pool: db.pool, push: db.push, intervalMs: 5, log: db.log });
    await new Promise((r) => setTimeout(r, 30));
    await p.stop();
    const after = db.connects();
    await new Promise((r) => setTimeout(r, 30));
    expect(db.connects()).toBe(after);
  });

  it('retryDelayMs doubles from the interval and never exceeds the cap', () => {
    expect([0, 1, 2, 3, 4, 5].map((f) => retryDelayMs(2000, f))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(retryDelayMs(2000, 500)).toBe(30000);
    expect(retryDelayMs(60000, 3)).toBe(60000);
  });
});

describe('level outbox publisher: the loop (fake timers)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('the first pass waits one interval, then the loop runs', async () => {
    vi.useFakeTimers();
    const db = fakeOutbox([row(1)]);
    const p = startOutboxPublisher({ pool: db.pool, push: db.push, intervalMs: 1000, log: db.log });
    await vi.advanceTimersByTimeAsync(999);
    expect(db.connects()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.publishedIds()).toEqual([1]);
    await p.stop();
  });

  it('a failed pass backs off: the next pass waits retryDelayMs, doubling per failure', async () => {
    vi.useFakeTimers();
    const db = fakeOutbox([row(1)]);
    const p = startOutboxPublisher({
      pool: db.pool,
      push: {
        publish() {
          throw new Error('nats down');
        },
      },
      intervalMs: 1000,
      log: db.log,
    });
    await vi.advanceTimersByTimeAsync(1000); // pass 1 fails: the next pass is 2000 ms later
    expect(db.connects()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(db.connects()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // pass 2 at 3000 ms fails: the next is 4000 ms later
    expect(db.connects()).toBe(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(db.connects()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.connects()).toBe(3);
    await p.stop();
  });

  it('a pass that succeeds resets the backoff to one interval', async () => {
    vi.useFakeTimers();
    const db = fakeOutbox([row(1, { version: 10 })]);
    let fail = true;
    const p = startOutboxPublisher({
      pool: db.pool,
      push: {
        publish(subject, body) {
          if (fail) throw new Error('nats down');
          db.push.publish(subject, body);
        },
      },
      intervalMs: 1000,
      log: db.log,
    });
    await vi.advanceTimersByTimeAsync(1000); // pass 1 fails: the next is 2000 ms later, at 3000
    expect(db.connects()).toBe(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(2000); // pass 2 publishes row 1: the next is 1000 ms later, at 4000
    expect(db.publishedIds()).toEqual([1]);
    db.committed.push({ ...row(2, { version: 11 }), published: false });
    fail = true;
    await vi.advanceTimersByTimeAsync(1000); // pass 3 at 4000 fails: a fresh first failure, 2000 ms
    expect(db.connects()).toBe(3);
    await vi.advanceTimersByTimeAsync(1999);
    expect(db.connects()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.connects()).toBe(4);
    await p.stop();
  });

  it('a full batch schedules the next pass at once; a short batch waits one interval', async () => {
    vi.useFakeTimers();
    const db = fakeOutbox([row(1, { version: 10 }), row(2, { version: 11 })]);
    const p = startOutboxPublisher({
      pool: db.pool,
      push: db.push,
      intervalMs: 1000,
      batch: 1,
      log: db.log,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2); // the zero-delay passes run 1 ms apart (Node clamps setTimeout(0) to 1 ms)
    expect(db.publishedIds()).toEqual([1, 2]);
    expect(db.connects()).toBe(3); // two full batches, then an empty pass
    await vi.advanceTimersByTimeAsync(999);
    expect(db.connects()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.connects()).toBe(4);
    await p.stop();
  });

  it('stop while a pass is in flight: no timer is left and no later pass starts', async () => {
    vi.useFakeTimers();
    const db = fakeOutbox([row(1)]);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let entered = 0;
    const pool = {
      connect: async () => {
        entered++;
        await gate;
        return db.pool.connect();
      },
    } as unknown as Pool;
    const p = startOutboxPublisher({ pool, push: db.push, intervalMs: 1000, log: db.log });
    await vi.advanceTimersByTimeAsync(1000); // the first pass is waiting for its connection
    expect(entered).toBe(1);
    const stopping = p.stop();
    open();
    await stopping;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(entered).toBe(1);
    expect(db.publishedIds()).toEqual([1]);
  });

  it('drainOnce after stop takes no connection and publishes nothing', async () => {
    const db = fakeOutbox([row(1)]);
    const p = startOutboxPublisher({
      pool: db.pool,
      push: db.push,
      intervalMs: 3_600_000,
      log: db.log,
    });
    await p.stop();
    expect(await p.drainOnce()).toBe(0);
    expect(db.connects()).toBe(0);
    expect(db.publishedIds()).toEqual([]);
  });

  it('the loop timer is unref-ed, so a publisher that is never stopped does not keep the process alive', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const db = fakeOutbox([]);
    const p = startOutboxPublisher({ pool: db.pool, push: db.push, intervalMs: 1000, log: db.log });
    const timer = spy.mock.results[0]?.value as { hasRef(): boolean };
    expect(timer.hasRef()).toBe(false);
    void p.stop();
  });
});

describe('level outbox publisher: subject drift against contract/src/subjects.ts', () => {
  const valid = ['colo', 'a1', 'a-b', 'a'.repeat(32)];
  // Refused by the contract's subject builder (SHARD in contract/src/subjects.ts): uppercase, underscore, a dot,
  // a one-character name, a leading digit, a 33-character name, empty.
  const invalid = ['Colo', 'co_lo', 'AG', 'a', '9x', 'bad.shard', 'a'.repeat(33), ''];

  it.each(valid)('shard %s: the pushed subject equals proficiencyPushSubject', async (shard) => {
    const db = fakeOutbox([row(1, { shard })]);
    const p = publisher(db);
    expect(await p.drainOnce()).toBe(1);
    expect(db.sent.map((s) => s.subject)).toEqual([proficiencyPushSubject(shard, LIFE)]);
    await p.stop();
  });

  it.each(invalid)(
    'shard %s: refused by the contract, so the row is logged, kept and not pushed',
    async (shard) => {
      expect(() => proficiencyPushSubject(shard, LIFE)).toThrow();
      const db = fakeOutbox([row(1, { shard })]);
      const p = publisher(db);
      expect(await p.drainOnce()).toBe(0);
      expect(db.sent).toEqual([]);
      expect(db.publishedIds()).toEqual([]);
      expect(db.logs).toEqual(['outbox_rejected outbox_id=1 total=1']);
      await p.stop();
    },
  );
});
