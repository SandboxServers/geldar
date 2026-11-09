/**
 * Integration test of the projection against the live phase0 stack (postgres and nats up,
 * eventsink running). Skipped unless GELDAR_IT=1. Reads the Postgres password from
 * compose/secrets/postgres.txt. Publishes intent, action and receipt events out of order and
 * twice, plus a second final receipt, on the geldar.phaseitproj.> subjects, then checks the tables.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const enabled = process.env.GELDAR_IT === '1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID-shaped id with the given prefix, unique per run. */
function freshId(prefix: string): string {
  let tail = '';
  for (let i = 0; i < 26; i++) tail += ALPHABET[Math.floor(Math.random() * 32)];
  return `${prefix}_${tail}`;
}

describe.skipIf(!enabled)('record projection against the live stack', () => {
  it('converges under redelivery and reorder, and dead-letters a second final receipt', async () => {
    const password = readFileSync(
      new URL('../../compose/secrets/postgres.txt', import.meta.url),
      'utf8',
    ).trim();
    const pool = new pg.Pool({ host: '127.0.0.1', user: 'geldar', database: 'geldar', password });
    const nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    const js = jetstream(nc);
    const jsm = await jetstreamManager(nc);
    const intentId = freshId('in');
    const interruptedId = freshId('in');
    const resumedId = freshId('in');
    const actionId = freshId('ac');
    const receiptA = freshId('rc');
    const receiptB = freshId('rc');
    const sourceIds: string[] = [];
    const publish = async (type: string, payload: object): Promise<void> => {
      const source = freshId('ev');
      sourceIds.push(source);
      await js.publish(
        `geldar.phaseitproj.${type}`,
        JSON.stringify({
          source_event_id: source,
          at: new Date().toISOString(),
          shard: 'phaseitproj',
          world_day: 0,
          world_tick: 1,
          type,
          agent_id: 'ag_kestrel_01',
          payload,
        }),
      );
    };
    const intent = (
      state: string,
      tick: number,
      extra: object = {},
      id = intentId,
      detail?: string,
    ) =>
      publish('intent', {
        intent_id: id,
        life_id: 'ag_kestrel_01',
        body_generation: 1,
        state,
        tick,
        ...(detail === undefined ? {} : { detail }),
        ...extra,
      });
    const fields = {
      goal: 'get_wood',
      program: 'gather',
      arguments: { item: 'oak_log' },
      preconditions: ['has_pickaxe'],
      wake_on: ['goal_completed'],
      limits: { max_world_ticks: 6000, max_block_operations: 40 },
    };
    const action = (state: string, receiptId: string | null) =>
      publish('action', {
        action_id: actionId,
        intent_id: intentId,
        life_id: 'ag_kestrel_01',
        body_generation: 1,
        sequence: 0,
        source_snapshot_id: freshId('sn'),
        snapshot_revision: 1,
        expires_tick: 900,
        kind: 'mine',
        args: {},
        state,
        result: null,
        receipt_id: receiptId,
      });
    const receipt = (receiptId: string, phase: string) =>
      publish('receipt', {
        receipt_id: receiptId,
        action_id: actionId,
        life_id: 'ag_kestrel_01',
        kind: 'mine',
        phase,
        at: new Date().toISOString(),
      });
    const lastSeq = async (): Promise<number> =>
      (await jsm.streams.info('GELDAR_EVENTS')).state.last_seq;
    try {
      const startSeq = await lastSeq();
      // Final state first, then the earlier ones, then a repeat of the final one.
      await intent('completed', 30);
      await intent('accepted', 10, fields);
      await intent('running', 12);
      await intent('completed', 30);
      await intent('accepted', 5, {}, interruptedId);
      await intent('interrupted', 8, {}, interruptedId, 'woke the Mind');
      // Interrupted at generation 1, resumed and completed by generation 2: ends completed.
      await intent('accepted', 4, {}, resumedId);
      await intent('interrupted', 8, {}, resumedId, 'restart');
      await intent('running', 10, { body_generation: 2 }, resumedId);
      await intent('completed', 20, { body_generation: 2 }, resumedId, 'done');
      await action('completed', receiptA);
      await action('accepted', null);
      await action('running', null);
      await receipt(receiptA, 'committed');
      await receipt(receiptA, 'committed');
      await receipt(receiptB, 'aborted'); // a second final receipt: must be dead-lettered
      await publish('reflex_fired', { name: 'eat' }); // no table: events only

      for (let i = 0; i < 40; i++) {
        const n = (
          await pool.query(
            'SELECT count(*)::int AS n FROM events WHERE source_event_id = ANY($1)',
            [sourceIds],
          )
        ).rows[0].n;
        if (n >= sourceIds.length - 1) break; // the rejected receipt rolls back with its event
        await sleep(500);
      }
      await sleep(2000);

      const intents = (await pool.query('SELECT * FROM intents WHERE intent_id = $1', [intentId]))
        .rows;
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        state: 'completed',
        started_tick: '10',
        ended_tick: '30',
        ...fields,
        checkpoint: null,
        thought_id: null,
      });
      const cut = (await pool.query('SELECT * FROM intents WHERE intent_id = $1', [interruptedId]))
        .rows;
      expect(cut[0]).toMatchObject({
        state: 'cancelled',
        ended_tick: '8',
        end_reason: 'interrupted: woke the Mind',
      });
      const resumed = (await pool.query('SELECT * FROM intents WHERE intent_id = $1', [resumedId]))
        .rows;
      expect(resumed[0]).toMatchObject({
        state: 'completed',
        body_generation: 2,
        ended_tick: '20',
        end_reason: 'done',
      });
      const actions = (await pool.query('SELECT * FROM actions WHERE action_id = $1', [actionId]))
        .rows;
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ state: 'completed', receipt_id: receiptA });
      const receipts = (
        await pool.query('SELECT receipt_id, phase FROM receipts WHERE action_id = $1', [actionId])
      ).rows;
      expect(receipts).toEqual([{ receipt_id: receiptA, phase: 'committed' }]);

      // The rejected receipt is on the DLQ with a reason naming the rule.
      const end = await lastSeq();
      let reason: string | undefined;
      for (let seq = end; seq > startSeq && reason === undefined; seq--) {
        const m = await jsm.streams.getMessage('GELDAR_EVENTS', { seq }).catch(() => null);
        if (m === null || m.subject !== 'geldar.phaseitproj.dlq') continue;
        const body = JSON.parse(new TextDecoder().decode(m.data));
        if (typeof body.data === 'string' && body.data.includes(receiptB)) reason = body.reason;
      }
      expect(reason).toContain('one final receipt per action');
    } finally {
      await pool.query('DELETE FROM receipts WHERE action_id = $1', [actionId]);
      await pool.query('DELETE FROM actions WHERE action_id = $1', [actionId]);
      await pool.query('DELETE FROM intents WHERE intent_id = ANY($1)', [
        [intentId, interruptedId, resumedId],
      ]);
      await pool.query('DELETE FROM events WHERE source_event_id = ANY($1)', [sourceIds]);
      await pool.end();
      await nc.drain();
    }
  });
});
