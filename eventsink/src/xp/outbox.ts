// The level outbox publisher (card AN-10b). Drains proficiency_outbox in outbox_id order and pushes each level
// change to `geldar.<shard>.state.<life>.level` (core NATS, outside the stream filter, decision 0280). A row is
// marked published in the same transaction that comes after its push, so a crash between the push and the mark
// republishes it (at least once). The push is advisory: the Body confirms by request/reply (AN-11a), so a lost
// push only delays the Body. Not wired into main.ts (AN-12 owns it).

import { type ProficiencyLevelPayload, validateProficiencyLevelPayload } from '@geldar/contract';
import type { Pool, PoolClient } from 'pg';

export interface LevelPush {
  publish(subject: string, body: string): void;
} // core NATS publish

/** The longest wait between failed drains. */
export const RETRY_CAP_MS = 30_000;

/** The wait after `failures` consecutive failed drains: intervalMs doubled per failure, capped. */
export function retryDelayMs(intervalMs: number, failures: number): number {
  const cap = Math.max(intervalMs, RETRY_CAP_MS);
  return Math.min(intervalMs * 2 ** Math.min(failures, 30), cap);
}

interface OutboxRow {
  outbox_id: string;
  life_id: string;
  domain: string;
  level: number;
  xp: number;
  version: string;
  shard: string;
  published_version: string | null;
}

// Unpublished rows in id order, minus the ids this process already rejected. published_version is the highest
// version already published for the same (life, domain); a row below it would move the version backwards.
const SELECT_BATCH = `
  SELECT o.outbox_id, o.life_id, o.domain, o.level, o.xp, o.version, a.shard,
    (SELECT MAX(p.version) FROM proficiency_outbox p
      WHERE p.life_id = o.life_id AND p.domain = o.domain AND p.published_at IS NOT NULL) AS published_version
  FROM proficiency_outbox o JOIN agents a ON a.agent_id = o.life_id
  WHERE o.published_at IS NULL AND NOT (o.outbox_id = ANY($2::bigint[]))
  ORDER BY o.outbox_id LIMIT $1
  FOR UPDATE OF o SKIP LOCKED`;

// Same pattern as SHARD in contract/src/subjects.ts (ShardName in common.schema.json). A row whose shard the
// contract's subject builder would refuse is a rejected row, not a push to a subject nobody subscribes to.
const SHARD_NAME = /^[a-z][a-z0-9-]{1,31}$/;

interface PublisherState {
  rejected: number;
  rejectedIds: Set<number>;
}

interface PassResult {
  seen: number;
  published: number;
  failed: boolean;
}

/** One transaction: push the claimed rows in order, then mark what was pushed (and what was collapsed). */
async function drainTransaction(
  client: PoolClient,
  o: { push: LevelPush; batch: number; log: (l: string) => void },
  state: PublisherState,
): Promise<PassResult> {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query<OutboxRow>(SELECT_BATCH, [o.batch, [...state.rejectedIds]]);
    const marks: number[] = [];
    const sent = new Map<string, number>();
    let published = 0;
    let failed = false;
    for (const r of rows) {
      const id = Number(r.outbox_id);
      const key = JSON.stringify([r.life_id, r.domain]);
      const version = Number(r.version);
      const floor = Math.max(
        r.published_version === null ? Number.NEGATIVE_INFINITY : Number(r.published_version),
        sent.get(key) ?? Number.NEGATIVE_INFINITY,
      );
      if (version < floor) {
        marks.push(id); // stale: a higher version already went out; collapse the row
        continue;
      }
      const payload: ProficiencyLevelPayload = {
        life_id: r.life_id,
        domain: r.domain as ProficiencyLevelPayload['domain'],
        level: r.level,
        xp: r.xp,
        version,
      };
      const checked = validateProficiencyLevelPayload(payload);
      if (!checked.ok || !SHARD_NAME.test(r.shard)) {
        state.rejectedIds.add(id);
        state.rejected++;
        o.log(`outbox_rejected outbox_id=${id} total=${state.rejected}`);
        continue;
      }
      try {
        o.push.publish(`geldar.${r.shard}.state.${r.life_id}.level`, JSON.stringify(checked.value));
      } catch (err) {
        failed = true;
        o.log(`outbox_push_failed outbox_id=${id} error=${(err as Error).message}`);
        break; // keep the order: nothing after a failed row goes out in this pass
      }
      marks.push(id);
      sent.set(key, version);
      published++;
    }
    if (marks.length > 0) {
      await client.query(
        'UPDATE proficiency_outbox SET published_at = now() WHERE outbox_id = ANY($1::bigint[])',
        [marks],
      );
    }
    await client.query('COMMIT');
    return { seen: rows.length, published, failed };
  } catch (err) {
    // A failed ROLLBACK must not replace the error that caused it; the caller releases the client with that error.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

export function startOutboxPublisher(o: {
  pool: Pool;
  push: LevelPush;
  intervalMs?: number /* default 2000 */;
  batch?: number /* default 100 */;
  log: (l: string) => void;
}): { stop(): Promise<void>; drainOnce(): Promise<number> } {
  const intervalMs = o.intervalMs ?? 2000;
  const batch = o.batch ?? 100;
  const state: PublisherState = { rejected: 0, rejectedIds: new Set() };
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One pass at a time: the loop and drainOnce never overlap on the same process.
  let chain: Promise<unknown> = Promise.resolve();

  const pass = (): Promise<PassResult> => {
    const run = chain.then(async () => {
      const client = await o.pool.connect();
      let broken: Error | undefined;
      try {
        return await drainTransaction(client, { push: o.push, batch, log: o.log }, state);
      } catch (err) {
        broken = err as Error;
        throw err;
      } finally {
        client.release(broken); // a failed transaction may have left the connection dead: never pool it
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };

  // unref: the loop alone does not keep the process alive; stop() clears it.
  const later = (delay: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const t = setTimeout(fn, delay);
    t.unref();
    return t;
  };

  const tick = async (): Promise<void> => {
    let delay = intervalMs;
    try {
      const r = await pass();
      failures = r.failed ? failures + 1 : 0;
      if (r.failed) delay = retryDelayMs(intervalMs, failures);
      else if (r.seen === batch) delay = 0; // a full batch: more rows may be waiting
    } catch (err) {
      failures++;
      delay = retryDelayMs(intervalMs, failures);
      o.log(`outbox_pass_failed error=${(err as Error).message} retry_ms=${delay}`);
    }
    if (!stopped) timer = later(delay, () => void tick());
  };

  // The first pass waits one interval: a restart reconciles within intervalMs, and a caller's drainOnce is not raced.
  timer = later(intervalMs, () => void tick());

  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await chain;
    },
    async drainOnce() {
      if (stopped) return 0; // after stop() a pass is a no-op: no connection is taken
      return (await pass()).published;
    },
  };
}
