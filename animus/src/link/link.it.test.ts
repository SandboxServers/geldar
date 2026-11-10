/**
 * Integration test of the Mind's end of the channel against the live NATS (loopback, no auth).
 * Skipped unless GELDAR_IT=1. A fake Body answers on the life's two subjects; the event source
 * and the publisher run over the real GELDAR_EVENTS stream on a shard of their own.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { planSubject, snapshotSubject, type WorldEvent } from '@geldar/contract';
import { jetstream } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { describe, expect, it } from 'vitest';
import type { MindEvent } from '../ports/index.ts';
import { BodyLinkError } from '../ports/index.ts';
import { eventOf, idOf, planOf, snapshotOf } from './link.fixtures.ts';
import { NatsBodyLink, natsRequestTransport } from './nats-body-link.ts';
import { jetStreamEventStream, NatsEventSource } from './nats-event-source.ts';
import { jetPublish, NatsPublisher } from './nats-publisher.ts';

const enabled = process.env.GELDAR_IT === '1';
const SHARD = 'phaseitlink';
const LIFE = 'ag_adam_03';

describe.skipIf(!enabled)('the Mind side of the Body-Mind channel against live NATS', () => {
  it('asks a fake Body for a snapshot and a plan ack, and reports a missing Body', async () => {
    const nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    try {
      const snapshots = nc.subscribe(snapshotSubject(SHARD, LIFE));
      const plans = nc.subscribe(planSubject(SHARD, LIFE));
      void (async () => {
        for await (const msg of snapshots) msg.respond(JSON.stringify(snapshotOf(2)));
      })();
      void (async () => {
        for await (const msg of plans) {
          const { thought_id } = JSON.parse(msg.string()) as { thought_id: string };
          msg.respond(JSON.stringify({ thought_id, accepted: true, rejection: null }));
        }
      })();
      const transport = natsRequestTransport(nc);
      const link = new NatsBodyLink({ transport, shard: SHARD, lifeId: LIFE });
      expect((await link.requestSnapshot('wake')).revision).toBe(2);
      expect((await link.submitPlan(planOf(1))).accepted).toBe(true);
      snapshots.unsubscribe();
      const lonely = new NatsBodyLink({ transport, shard: SHARD, lifeId: 'ag_nobody_01' });
      const error = await lonely.requestSnapshot('wake').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BodyLinkError);
      expect((error as BodyLinkError).code).toBe('unavailable');
    } finally {
      await nc.drain();
    }
  });

  it('delivers events published after it starts, for its life only, and publishes thoughts', async () => {
    const nc = await connect({ servers: 'nats://127.0.0.1:4222' });
    try {
      const js = jetstream(nc);
      const source = new NatsEventSource({ stream: jetStreamEventStream(js), shard: SHARD });
      await source.start();
      const got: MindEvent[] = [];
      source.subscribe(LIFE, (event) => got.push(event));
      const tail = `${Date.now()}`.padStart(26, '0').slice(-26);
      const mine: WorldEvent = {
        ...eventOf('speech', 1),
        shard: SHARD,
        source_event_id: `ev_${tail}`,
      };
      const theirs: WorldEvent = {
        ...eventOf('speech', 2, 'ag_eve_01'),
        shard: SHARD,
        source_event_id: idOf('ev', 2),
      };
      const publisher = new NatsPublisher(jetPublish(js));
      const thought: WorldEvent = {
        ...eventOf('wake', 3),
        shard: SHARD,
        type: 'thought',
        source_event_id: `ev_${tail.replace(/0$/, '1')}`,
        payload: {
          thought_id: idOf('th', 1),
          wake_reason: 'idle',
          outcome: 'planned',
          latency_ms: 1,
          model_config: 'it',
          effort: 'low',
          intent_id: null,
        },
      };
      await js.publish(`geldar.${SHARD}.speech`, JSON.stringify(theirs));
      await js.publish(`geldar.${SHARD}.speech`, JSON.stringify(mine));
      await publisher.publish(thought);
      for (let i = 0; i < 50 && got.length === 0; i++) await sleep(100);
      source.stop();
      expect(got.map((event) => event.eventId)).toEqual([mine.source_event_id]);
    } finally {
      await nc.drain();
    }
  });
});
