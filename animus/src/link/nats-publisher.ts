/**
 * The Mind's own events (spec section 7): `thought` and `reflection`, published to JetStream on
 * `geldar.<shard>.<type>`. `Nats-Msg-Id` is the event's `source_event_id`, so a retried publish
 * is one event to the stream.
 */
import { validateThoughtEventPayload, validateWorldEvent, type WorldEvent } from '@geldar/contract';
import type { JetStreamClient } from '@nats-io/jetstream';
import type { EventPublisher } from '../ports/index.ts';

/** The event types this publisher sends. */
const PUBLISHED_TYPES: readonly string[] = ['thought', 'reflection'];

/** The part of a JetStream client the publisher uses (a fake in tests). */
export interface JetPublish {
  /** Stores `body` on `subject`; `msgID` is the stream's de-duplication key. */
  publish(subject: string, body: string, options: { msgID: string }): Promise<unknown>;
}

/** The publisher over a JetStream client. */
export function jetPublish(js: JetStreamClient): JetPublish {
  return { publish: (subject, body, options) => js.publish(subject, body, options) };
}

/** An `EventPublisher` for the Mind's `thought` and `reflection` events. */
export class NatsPublisher implements EventPublisher {
  private readonly js: JetPublish;

  constructor(js: JetPublish) {
    this.js = js;
  }

  /** Rejects when the event is invalid, is of another type, or the broker does not store it. */
  async publish(event: WorldEvent): Promise<void> {
    if (!PUBLISHED_TYPES.includes(event.type)) {
      throw new Error(`the Mind publishes thought and reflection events, not ${event.type}`);
    }
    const envelope = validateWorldEvent(event);
    if (!envelope.ok) throw new Error(`invalid event: ${envelope.errors.join('; ')}`);
    if (event.type === 'thought') {
      const payload = validateThoughtEventPayload(event.payload);
      if (!payload.ok) throw new Error(`invalid thought payload: ${payload.errors.join('; ')}`);
    }
    await this.js.publish(`geldar.${event.shard}.${event.type}`, JSON.stringify(event), {
      msgID: event.source_event_id,
    });
  }
}
