/**
 * Integration test against the live phase0 stack (postgres and nats up, eventsink running).
 * Skipped unless GELDAR_IT=1. Reads the Postgres password from compose/secrets/postgres.txt.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from 'nats';
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
    const js = nc.jetstream();
    const id = freshId();
    const event = {
      source_event_id: id,
      at: new Date().toISOString(),
      shard: 'phaseit',
      world_day: 0,
      world_tick: 1,
      type: 'damage',
      payload: { amount: 1 },
    };
    try {
      const dlq = await nc.jetstreamManager();
      const before = (await dlq.streams.info('GELDAR_EVENTS')).state.messages;
      // Same body twice, without a JetStream message id, so the sink (not the stream) must dedupe.
      await js.publish('geldar.phaseit.damage', JSON.stringify(event));
      await js.publish('geldar.phaseit.damage', JSON.stringify(event));
      await js.publish('geldar.phaseit.damage', JSON.stringify({ not: 'an event' }));

      let count = 0;
      for (let i = 0; i < 40 && count < 1; i++) {
        await sleep(500);
        const rows = await pool.query(
          'SELECT count(*)::int AS n FROM events WHERE source_event_id = $1',
          [id],
        );
        count = rows.rows[0].n;
      }
      await sleep(2000); // let the duplicate and the malformed message be processed
      const rows = await pool.query(
        'SELECT count(*)::int AS n FROM events WHERE source_event_id = $1',
        [id],
      );
      expect(rows.rows[0].n).toBe(1);

      // 3 published + 1 dead letter the sink wrote back into the stream.
      const after = (await dlq.streams.info('GELDAR_EVENTS')).state.messages;
      expect(after - before).toBe(4);
      const last = await dlq.streams.getMessage('GELDAR_EVENTS', {
        last_by_subj: 'geldar.phaseit.dlq',
      });
      expect(JSON.parse(new TextDecoder().decode(last.data)).reason).toBeTruthy();
    } finally {
      await pool.query('DELETE FROM events WHERE source_event_id = $1', [id]);
      await pool.end();
      await nc.drain();
    }
  });
});
