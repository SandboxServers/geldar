/**
 * Integration test against the live phase0 stack (postgres and nats up, eventsink running).
 * Skipped unless GELDAR_IT=1. Reads the Postgres password from compose/secrets/postgres.txt.
 * This is also the only test that runs the real INSERT (unnest, jsonb[], ON CONFLICT): the unit
 * tests use fakes. It counts only the geldar.phaseit.> subjects, because the live plugin publishes
 * into the same stream.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const enabled = process.env.GELDAR_IT === '1';

/** A ULID-shaped id that is unique per run (Crockford base32 without I, L, O, U). */
function freshId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let tail = '';
  for (let i = 0; i < 26; i++) tail += alphabet[Math.floor(Math.random() * 32)];
  return `ev_${tail}`;
}

describe.skipIf(!enabled)('eventsink against the live stack', () => {
  it('stores a twice-published event once and dead-letters a malformed one', async () => {
    const password = readFileSync(
      new URL('../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim();
    const pool = new pg.Pool({ host: '127.0.0.1', user: 'geldar', database: 'geldar', password });
    const nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    const js = jetstream(nc);
    const jsm = await jetstreamManager(nc);
    const id = freshId();
    const otherId = freshId();
    const marker = `marker-${id}`;
    const event = (sourceId: string) => ({
      source_event_id: sourceId,
      at: new Date().toISOString(),
      shard: 'phaseit',
      world_day: 0,
      world_tick: 1,
      type: 'damage',
      payload: { amount: 1 },
    });
    const count = async (sourceId: string): Promise<number> =>
      (
        await pool.query('SELECT count(*)::int AS n FROM events WHERE source_event_id = $1', [
          sourceId,
        ])
      ).rows[0].n;
    /** Messages in the stream on the phaseit subjects only (the live plugin uses other shards). */
    const phaseitMessages = async (): Promise<number> =>
      Object.values(
        (await jsm.streams.info('GELDAR_EVENTS', { subjects_filter: 'geldar.phaseit.>' })).state
          .subjects ?? {},
      ).reduce((sum, n) => sum + n, 0);
    try {
      const before = await phaseitMessages();
      // The same body twice, without a JetStream message id, so the sink (not the stream) must
      // dedupe; a second event next to it makes the batch several rows through the real unnest.
      await js.publish('geldar.phaseit.damage', JSON.stringify(event(id)));
      await js.publish('geldar.phaseit.damage', JSON.stringify(event(id)));
      await js.publish('geldar.phaseit.damage', JSON.stringify(event(otherId)));
      await js.publish('geldar.phaseit.damage', JSON.stringify({ not: 'an event', marker }));

      for (let i = 0; i < 40 && (await count(id)) < 1; i++) await sleep(500);
      await sleep(2000); // let the duplicate and the malformed message be processed
      expect(await count(id)).toBe(1);
      expect(await count(otherId)).toBe(1);

      // 4 published + 1 dead letter the sink wrote back, on phaseit subjects only.
      expect((await phaseitMessages()) - before).toBe(5);
      // Find this run's dead letter by its marker, not just the newest one on the subject.
      const lastSeq = (await jsm.streams.info('GELDAR_EVENTS')).state.last_seq;
      let found: { reason?: string } | undefined;
      for (let seq = lastSeq; seq > Math.max(0, lastSeq - 200) && !found; seq--) {
        const m = await jsm.streams.getMessage('GELDAR_EVENTS', { seq }).catch(() => null);
        if (m === null || m.subject !== 'geldar.phaseit.dlq') continue;
        const body = JSON.parse(new TextDecoder().decode(m.data));
        if (typeof body.data === 'string' && body.data.includes(marker)) found = body;
      }
      expect(found?.reason).toBeTruthy();
    } finally {
      await pool.query('DELETE FROM events WHERE source_event_id = ANY($1)', [[id, otherId]]);
      await pool.end();
      await nc.drain();
    }
  });
});
