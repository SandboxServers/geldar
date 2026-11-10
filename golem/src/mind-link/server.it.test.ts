/**
 * Integration test of the Body's end of the channel against the live NATS (loopback, no auth).
 * Skipped unless GELDAR_IT=1. The server runs with a fake Body (stub executor, fake senses); the
 * requests are plain NATS requests on the life's two subjects.
 */
import { type PlanAck, planSubject, type Snapshot, snapshotSubject } from '@geldar/contract';
import { connect } from '@nats-io/transport-node';
import { describe, expect, it } from 'vitest';
import { SnapshotRevision } from './revision.ts';
import { FakeEars, FakePerception, FakeVoice } from './senses.fakes.ts';
import { GENERATION, planOf, StubExecutor, snapshotFrom } from './server.fakes.ts';
import { MindLinkServer, natsRequestServer } from './server.ts';

const enabled = process.env.GELDAR_IT === '1';
const SHARD = 'phaseitlink';
const LIFE = 'ag_adam_01';

describe.skipIf(!enabled)('the Body side of the Body-Mind channel against live NATS', () => {
  it('serves a snapshot, acks a plan, speaks and reports the result', async () => {
    const nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    const voice = new FakeVoice();
    const published: string[] = [];
    const server = new MindLinkServer({
      shard: SHARD,
      lifeId: LIFE,
      bodyGeneration: GENERATION,
      revision: new SnapshotRevision(),
      server: natsRequestServer(nc),
      executor: new StubExecutor(),
      perception: new FakePerception(),
      ears: new FakeEars(),
      voice,
      buildSnapshot: snapshotFrom,
      tick: () => 10,
      publisher: {
        async publish(subject) {
          published.push(subject);
        },
      },
    });
    server.start();
    try {
      const snap = await nc.request(
        snapshotSubject(SHARD, LIFE),
        JSON.stringify({ life_id: LIFE, reason: 'wake' }),
        { timeout: 5000 },
      );
      expect((snap.json() as Snapshot).revision).toBe(1);
      const ackMsg = await nc.request(planSubject(SHARD, LIFE), JSON.stringify(planOf(1)), {
        timeout: 2000,
      });
      expect((ackMsg.json() as PlanAck).accepted).toBe(true);
      await server.idle();
      expect(voice.said).toEqual(['hello there']);
      expect(published).toEqual([`geldar.${SHARD}.plan_result`]);
    } finally {
      await server.stop();
      await nc.drain();
    }
  });
});
