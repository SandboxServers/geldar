import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { MindEvent } from '../ports/index.ts';
import { eventOf, FakeEventStream, LIFE, PAYLOADS, SHARD } from './link.fixtures.ts';
import { MIND_EVENT_TYPES, mindEventSubjects } from './mind-event.ts';
import { NatsEventSource } from './nats-event-source.ts';

async function rig() {
  const stream = new FakeEventStream();
  const logs: string[] = [];
  const source = new NatsEventSource({ stream, shard: SHARD, log: (line) => logs.push(line) });
  await source.start();
  const got: MindEvent[] = [];
  source.subscribe(LIFE, (event) => got.push(event));
  return { stream, source, got, logs };
}

describe('NatsEventSource', () => {
  it('opens a consumer on exactly the ten Mind subjects of the shard', async () => {
    const { stream } = await rig();
    expect(stream.openedWith).toEqual(mindEventSubjects(SHARD));
    expect(stream.openedWith).toEqual(
      [
        'wake',
        'intent',
        'action',
        'plan_result',
        'action_outcome',
        'reflex_fired',
        'speech',
        'damage',
        'death',
        'sleep',
      ].map((type) => `geldar.${SHARD}.${type}`),
    );
  });

  it.each(MIND_EVENT_TYPES)('normalises a %s event of this life', async (type) => {
    const { stream, got } = await rig();
    stream.push(eventOf(type, 7));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      type,
      eventId: eventOf(type, 7).source_event_id,
      lifeId: LIFE,
      tick: 5,
      day: 0,
      at: '2026-11-09T12:00:00.000Z',
      payload: PAYLOADS[type],
    });
  });

  it('keeps only events whose agent_id is a subscribed life', async () => {
    const { stream, got, source } = await rig();
    stream.push(eventOf('wake', 1, 'ag_eve_01'));
    stream.push(eventOf('wake', 2, null));
    stream.push(eventOf('wake', 3));
    expect(got.map((e) => e.eventId)).toEqual([eventOf('wake', 3).source_event_id]);
    expect(source.counts).toEqual({ invalid: 0, otherLife: 2 });
  });

  it('drops and counts an invalid envelope, a bad payload and text that is not JSON', async () => {
    const { stream, got, source, logs } = await rig();
    const noTick = { ...eventOf('wake', 1) } as Partial<WorldEvent>;
    delete noTick.world_tick;
    stream.push(JSON.stringify(noTick), `geldar.${SHARD}.wake`);
    stream.push({ ...eventOf('wake', 2), payload: { reason: 'idle' } });
    stream.push({ ...eventOf('speech', 3), payload: { from: 'Eve' } });
    stream.push({ ...eventOf('damage', 4), payload: [] as unknown as Record<string, unknown> });
    stream.push('{nope', `geldar.${SHARD}.wake`);
    expect(got).toEqual([]);
    expect(source.counts.invalid).toBe(5);
    expect(logs).toHaveLength(5);
  });

  it('drops an event whose subject type differs from its own type', async () => {
    const { stream, got, source } = await rig();
    stream.push(eventOf('wake', 1), `geldar.${SHARD}.death`);
    expect(got).toEqual([]);
    expect(source.counts.invalid).toBe(1);
  });

  it('skips types the Mind does not read without counting them', async () => {
    const { stream, got, source } = await rig();
    stream.push({ ...eventOf('wake', 1), type: 'trade' }, `geldar.${SHARD}.trade`);
    expect(got).toEqual([]);
    expect(source.counts).toEqual({ invalid: 0, otherLife: 0 });
  });

  it('hands an event on once and survives a throwing handler', async () => {
    const { stream, source } = await rig();
    const seen: string[] = [];
    source.subscribe(LIFE, () => {
      throw new Error('boom');
    });
    source.subscribe(LIFE, (event) => seen.push(event.eventId));
    stream.push(eventOf('wake', 1));
    stream.push(eventOf('wake', 1));
    expect(seen).toHaveLength(1);
  });

  it('stops delivering to an unsubscribed handler and closes the consumer on stop', async () => {
    const { stream, source } = await rig();
    const seen: string[] = [];
    const off = source.subscribe(LIFE, (event) => seen.push(event.eventId));
    off();
    off();
    stream.push(eventOf('wake', 1));
    expect(seen).toEqual([]);
    source.stop();
    expect(stream.closed).toBe(true);
  });
});
