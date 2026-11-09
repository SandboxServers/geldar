import { createHash } from 'node:crypto';
import {
  type ActionRecord,
  type Receipt,
  validateActionRecord,
  validateIntentEventPayload,
  validateReceipt,
  validateReflexFiredPayload,
  validateWakePayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import type { JetStreamClient } from '@nats-io/jetstream';
import type { IntentChange, RecordSink, ReflexFiredRecord } from './records.ts';
import type { WakeRequest } from './wake.ts';

/** Where encoded events go. The real one is JetStream; tests pass a fake. */
export interface EventPublisher {
  /** Stores `body` on `subject`; `msgId` lets the stream drop a duplicate. Rejects on failure. */
  publish(subject: string, body: string, msgId: string): Promise<void>;
}

/** The publisher over a JetStream client; the message id is the stream's de-duplication key. */
export function jetStreamPublisher(js: JetStreamClient): EventPublisher {
  return {
    async publish(subject, body, msgId) {
      await js.publish(subject, body, { msgID: msgId });
    },
  };
}

/** What the sink needs to know about the Body it serves. */
export interface NatsSinkOptions {
  publisher: EventPublisher;
  /** Shard name: events go to `geldar.<shard>.<type>`. */
  shard: string;
  /** The life this Body plays; the `agent_id` of every event and the owner of its wakes. */
  lifeId: string;
  /** World age now (for records that carry no tick of their own); default 0. */
  worldTick?: () => number;
  /** Wall clock for `at`; default `new Date()`. */
  now?: () => Date;
  /** Where publish failures and dropped records are reported; default `console.error`. */
  log?: (line: string) => void;
  /** Publish attempts per event before it is dropped and logged; default 5. */
  attempts?: number;
  /** First retry delay in ms, doubling each time; default 200. */
  retryDelayMs?: number;
}

/** Minecraft ticks in one world day. */
const TICKS_PER_DAY = 24_000;

/** Longest `detail` in a payload (the schemas' maxLength). */
const DETAIL_LIMIT = 256;

/** Events waiting to go out; past this, new ones are dropped and logged rather than growing memory. */
const MAX_PENDING = 10_000;

/** Crockford base32, the alphabet of the contract's ids. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A deterministic `ev_` id: the first 130 bits of the SHA-256 of `key`, in Crockford base32.
 * The same record always gets the same id, which is what makes a retry or a replay dedup.
 */
export function eventIdFor(key: string): string {
  const digest = createHash('sha256').update(key).digest();
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of digest) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return `ev_${out}`;
}

function clip(text: string | undefined): string | undefined {
  return text === undefined ? undefined : text.slice(0, DETAIL_LIMIT);
}

/**
 * A `RecordSink` that publishes each record as a `WorldEvent` of type `intent`, `action`,
 * `receipt`, `reflex_fired` or `wake` on `geldar.<shard>.<type>`. The sink's methods return at
 * once and never throw: events leave in order through one queue, each retried with backoff, and
 * one that cannot be sent is logged and dropped. `source_event_id` comes from the record (for an
 * action, its `action_id` and `state`), so a retry or a replay is one event to the sink.
 */
export class NatsRecordSink implements RecordSink {
  private readonly opts: NatsSinkOptions;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(options: NatsSinkOptions) {
    this.opts = options;
  }

  intentChanged(change: IntentChange): void {
    this.emit(
      'intent',
      `intent:${change.intentId}:${change.state}:${change.tick}`,
      change.tick,
      {
        intent_id: change.intentId,
        life_id: change.lifeId,
        body_generation: change.bodyGeneration,
        state: change.state,
        tick: change.tick,
        ...(change.detail === undefined ? {} : { detail: clip(change.detail) }),
      },
      validateIntentEventPayload,
    );
  }

  actionChanged(record: ActionRecord): void {
    this.emit(
      'action',
      `action:${record.action_id}:${record.state}`,
      this.tickNow(),
      structuredClone(record),
      validateActionRecord,
    );
  }

  receipt(receipt: Receipt): void {
    this.emit(
      'receipt',
      `receipt:${receipt.receipt_id}:${receipt.phase}`,
      this.tickNow(),
      structuredClone(receipt),
      validateReceipt,
    );
  }

  reflexFired(record: ReflexFiredRecord): void {
    this.emit(
      'reflex_fired',
      `reflex_fired:${record.lifeId}:${record.bodyGeneration}:${record.name}:${record.tick}`,
      record.tick,
      {
        name: record.name,
        life_id: record.lifeId,
        body_generation: record.bodyGeneration,
        tick: record.tick,
        trigger: { ...record.trigger },
        outcome: {
          result: record.outcome.result,
          ...(record.outcome.detail === undefined ? {} : { detail: clip(record.outcome.detail) }),
        },
      },
      validateReflexFiredPayload,
    );
  }

  wake(request: WakeRequest): void {
    this.emit(
      'wake',
      `wake:${this.opts.lifeId}:${request.tick}:${request.reason}:${request.intentId ?? ''}`,
      request.tick,
      {
        reason: request.reason,
        tick: request.tick,
        intent_id: request.intentId,
        ...(request.detail === undefined ? {} : { detail: clip(request.detail) }),
      },
      validateWakePayload,
    );
  }

  /** Resolves once every event queued so far has been published or dropped. */
  flush(): Promise<void> {
    return this.tail;
  }

  private tickNow(): number {
    return this.opts.worldTick?.() ?? 0;
  }

  private log(line: string): void {
    (this.opts.log ?? ((l: string) => console.error(l)))(line);
  }

  /** Builds, checks and queues one event. Never throws. */
  private emit(
    type: string,
    key: string,
    tick: number,
    payload: object,
    check: (value: unknown) => { ok: boolean; errors?: string[] },
  ): void {
    try {
      const event: WorldEvent = {
        source_event_id: eventIdFor(key),
        at: (this.opts.now?.() ?? new Date()).toISOString(),
        shard: this.opts.shard,
        world_day: Math.floor(tick / TICKS_PER_DAY),
        world_tick: tick,
        type,
        agent_id: this.opts.lifeId,
        payload: payload as WorldEvent['payload'],
      };
      const checked = check(payload);
      const whole = validateWorldEvent(event);
      if (!checked.ok || !whole.ok) {
        const errors = [...(checked.errors ?? []), ...(whole.ok ? [] : whole.errors)];
        this.log(`records: dropped ${type} record, not valid: ${errors.join('; ')}`);
        return;
      }
      if (this.pending >= MAX_PENDING) {
        this.log(`records: dropped ${type} record, ${MAX_PENDING} events are waiting to send`);
        return;
      }
      this.pending++;
      const send = this.tail.then(() => this.send(event));
      this.tail = send.finally(() => {
        this.pending--;
      });
    } catch (error) {
      this.log(`records: dropped ${type} record: ${String(error)}`);
    }
  }

  /** Publishes with backoff; logs and gives up after the last attempt. Never rejects. */
  private async send(event: WorldEvent): Promise<void> {
    const attempts = this.opts.attempts ?? 5;
    let delay = this.opts.retryDelayMs ?? 200;
    const subject = `geldar.${event.shard}.${event.type}`;
    const body = JSON.stringify(event);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.opts.publisher.publish(subject, body, event.source_event_id);
        return;
      } catch (error) {
        if (attempt === attempts) {
          this.log(
            `records: dropped ${event.type} ${event.source_event_id} after ${attempts} attempts: ${String(error)}`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
}
