import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { eventOf, idOf, LIFE, SHARD } from './link.fixtures.ts';
import { type JetPublish, NatsPublisher } from './nats-publisher.ts';

function rig(fail = false) {
  const sent: Array<{ subject: string; body: string; msgID: string }> = [];
  const js: JetPublish = {
    async publish(subject, body, options) {
      if (fail) throw new Error('broker down');
      sent.push({ subject, body, msgID: options.msgID });
    },
  };
  return { sent, publisher: new NatsPublisher(js) };
}

const thought = (): WorldEvent => ({
  ...eventOf('wake', 5),
  type: 'thought',
  payload: {
    thought_id: idOf('th', 1),
    wake_reason: 'idle',
    outcome: 'planned',
    latency_ms: 800,
    model_config: 'qwen:abc',
    effort: 'medium',
    intent_id: null,
  },
});

describe('NatsPublisher', () => {
  it('publishes a thought on its subject with the source_event_id as Nats-Msg-Id', async () => {
    const { publisher, sent } = rig();
    await publisher.publish(thought());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe(`geldar.${SHARD}.thought`);
    expect(sent[0]?.msgID).toBe(idOf('ev', 5));
    expect(JSON.parse(sent[0]?.body ?? '{}').agent_id).toBe(LIFE);
  });

  it('publishes a reflection on its subject', async () => {
    const { publisher, sent } = rig();
    await publisher.publish({
      ...eventOf('wake', 6),
      type: 'reflection',
      payload: { summary: 'x' },
    });
    expect(sent[0]?.subject).toBe(`geldar.${SHARD}.reflection`);
    expect(sent[0]?.msgID).toBe(idOf('ev', 6));
  });

  it('refuses other types, an invalid envelope and an invalid thought payload', async () => {
    const { publisher, sent } = rig();
    await expect(publisher.publish(eventOf('wake', 1))).rejects.toThrow(/not wake/);
    await expect(publisher.publish({ ...thought(), at: 'yesterday' })).rejects.toThrow(/invalid/);
    await expect(publisher.publish({ ...thought(), payload: { thought_id: 'x' } })).rejects.toThrow(
      /thought payload/,
    );
    expect(sent).toEqual([]);
  });

  it('rejects when the broker does not store the event', async () => {
    await expect(rig(true).publisher.publish(thought())).rejects.toThrow(/broker down/);
  });
});
