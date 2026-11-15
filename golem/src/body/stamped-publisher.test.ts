import { validateWorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from './records-nats.ts';
import { stampedPublisher } from './stamped-publisher.ts';

interface Sent {
  subject: string;
  body: string;
  msgId: string;
}

function recorder(): { inner: EventPublisher; sent: Sent[] } {
  const sent: Sent[] = [];
  const inner: EventPublisher = {
    publish: async (subject, body, msgId) => {
      sent.push({ subject, body, msgId });
    },
  };
  return { inner, sent };
}

/** A valid envelope of one event type, as the Body's builders make it. */
function eventOf(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_event_id: 'ev_0123456789ABCDEFGHJKMNPQRS',
    at: '2026-11-14T10:00:00.000Z',
    shard: 'phase0',
    world_day: 1,
    world_tick: 100,
    type,
    agent_id: 'ag_adam_01',
    payload: { sequence: 1 },
    ...extra,
  };
}

const STAMP = { harness: 'claude', model: 'claude-haiku-5-5' };
const FIVE_KINDS = ['speech', 'heard_sound', 'damage', 'plan_result', 'action_outcome'];

describe('stampedPublisher', () => {
  it('returns the inner publisher itself when there is no stamp (off is the old path)', () => {
    const { inner } = recorder();
    expect(stampedPublisher(inner, undefined)).toBe(inner);
    expect(stampedPublisher(inner, {})).toBe(inner);
  });

  it('stamps every event kind with the run harness and model', async () => {
    const { inner, sent } = recorder();
    const publisher = stampedPublisher(inner, STAMP);
    for (const type of FIVE_KINDS) {
      await publisher.publish(
        `geldar.phase0.${type}`,
        JSON.stringify(eventOf(type)),
        'ev_0123456789ABCDEFGHJKMNPQRS',
      );
    }
    expect(sent).toHaveLength(FIVE_KINDS.length);
    for (const [index, type] of FIVE_KINDS.entries()) {
      const event = JSON.parse(sent[index]?.body ?? '{}') as Record<string, unknown>;
      expect(event).toMatchObject({ type, harness: 'claude', model: 'claude-haiku-5-5' });
    }
  });

  it('keeps the subject and the msgId, and the source_event_id, unchanged', async () => {
    const { inner, sent } = recorder();
    await stampedPublisher(inner, STAMP).publish(
      'geldar.phase0.damage',
      JSON.stringify(eventOf('damage')),
      'ev_0123456789ABCDEFGHJKMNPQRS',
    );
    expect(sent[0]?.subject).toBe('geldar.phase0.damage');
    expect(sent[0]?.msgId).toBe('ev_0123456789ABCDEFGHJKMNPQRS');
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({
      source_event_id: 'ev_0123456789ABCDEFGHJKMNPQRS',
    });
  });

  it('leaves an event without agent_id as the same bytes', async () => {
    const { inner, sent } = recorder();
    const body = JSON.stringify(eventOf('damage', { agent_id: undefined }));
    await stampedPublisher(inner, STAMP).publish(
      'geldar.phase0.damage',
      body,
      'ev_0123456789ABCDEFGHJKMNPQRS',
    );
    expect(sent[0]?.body).toBe(body);
  });

  it('passes a body that is not valid JSON through unchanged', async () => {
    const { inner, sent } = recorder();
    await stampedPublisher(inner, STAMP).publish('geldar.phase0.damage', '{not json', 'x');
    expect(sent[0]?.body).toBe('{not json');
  });

  it('does not overwrite a harness or model the event already carries', async () => {
    const { inner, sent } = recorder();
    const body = JSON.stringify(eventOf('damage', { harness: 'chatgpt', model: 'gpt-5' }));
    await stampedPublisher(inner, STAMP).publish(
      'geldar.phase0.damage',
      body,
      'ev_0123456789ABCDEFGHJKMNPQRS',
    );
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({ harness: 'chatgpt', model: 'gpt-5' });
  });

  it('sets only the fields the stamp declares', async () => {
    const { inner, sent } = recorder();
    await stampedPublisher(inner, { harness: 'claude' }).publish(
      'geldar.phase0.damage',
      JSON.stringify(eventOf('damage')),
      'ev_0123456789ABCDEFGHJKMNPQRS',
    );
    const event = JSON.parse(sent[0]?.body ?? '{}') as Record<string, unknown>;
    expect(event.harness).toBe('claude');
    expect('model' in event).toBe(false);
  });

  it('a stamped event passes validateWorldEvent', async () => {
    const { inner, sent } = recorder();
    await stampedPublisher(inner, STAMP).publish(
      'geldar.phase0.damage',
      JSON.stringify(eventOf('damage')),
      'ev_0123456789ABCDEFGHJKMNPQRS',
    );
    const check = validateWorldEvent(JSON.parse(sent[0]?.body ?? '{}'));
    expect(check.ok, check.ok ? '' : check.errors.join('; ')).toBe(true);
  });
});
