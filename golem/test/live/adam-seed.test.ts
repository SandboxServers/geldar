import { describe, expect, it } from 'vitest';
import { type BodyKv, parseEntry } from '../../src/body/checkpoint.ts';
import { fakeKv } from '../../src/body/restart.fakes.ts';
import {
  currentGeneration,
  type SeedOptions,
  seedRunningIntent,
  travelIntent,
} from './adam-seed.ts';

const LIFE = 'ag_adam_02';
const INTENT = 'in_0000000000000000000000SEED';
const TARGET = { x: 5, y: 65, z: 7 };

function options(over: Partial<SeedOptions> = {}): SeedOptions {
  return {
    lifeId: LIFE,
    shard: 'phase0',
    bodyGeneration: 4,
    intentId: INTENT,
    tick: 1000,
    expiresTick: 50_000,
    intent: travelIntent(TARGET),
    checkpoint: { target: TARGET, legs: 0 },
    ...over,
  };
}

/** A publisher that records what it was asked to send. */
function recordingPublisher() {
  const sent: { subject: string; body: string; msgId: string }[] = [];
  return {
    sent,
    publisher: {
      async publish(subject: string, body: string, msgId: string): Promise<void> {
        sent.push({ subject, body, msgId });
      },
    },
  };
}

describe('seedRunningIntent', () => {
  it('stores a checkpoint that the restarted Body reads back as this running intent', async () => {
    const checkpoints = fakeKv();
    const { publisher } = recordingPublisher();
    await seedRunningIntent({ checkpoints, generations: fakeKv(), publisher }, options());
    const stored = await checkpoints.get(LIFE);
    expect(parseEntry(stored?.value ?? 'not json')).toMatchObject({
      life_id: LIFE,
      body_generation: 4,
      intent_id: INTENT,
      program: 'travel',
      expires_tick: 50_000,
      block_operations_used: 0,
      checkpoint: { target: TARGET, legs: 0 },
    });
  });

  it('publishes the accepted and running rows of the intent on the shard, in order', async () => {
    const { sent, publisher } = recordingPublisher();
    await seedRunningIntent({ checkpoints: fakeKv(), generations: fakeKv(), publisher }, options());
    expect(sent.map((m) => m.subject)).toEqual(['geldar.phase0.intent', 'geldar.phase0.intent']);
    const events = sent.map((m) => JSON.parse(m.body) as { agent_id: string; payload: unknown });
    expect(events.map((e) => (e.payload as { state: string }).state)).toEqual([
      'accepted',
      'running',
    ]);
    expect(events[0]?.agent_id).toBe(LIFE);
    expect(events[0]?.payload).toMatchObject({
      intent_id: INTENT,
      body_generation: 4,
      program: 'travel',
      arguments: { target: TARGET },
    });
  });

  it('fails when the checkpoint write does not reach the bucket', async () => {
    const base = fakeKv();
    const refusing: BodyKv = { ...base, put: async () => Promise.reject(new Error('bucket down')) };
    const { publisher } = recordingPublisher();
    await expect(
      seedRunningIntent({ checkpoints: refusing, generations: fakeKv(), publisher }, options()),
    ).rejects.toThrow('was not stored');
  });
});

describe('currentGeneration', () => {
  it('reads the generation the Body took from its bucket', async () => {
    const generations = fakeKv();
    await generations.create(LIFE, '7');
    expect(await currentGeneration(generations, LIFE)).toBe(7);
  });

  it('throws when no generation is stored for the life', async () => {
    await expect(currentGeneration(fakeKv(), LIFE)).rejects.toThrow('no body generation');
  });
});
