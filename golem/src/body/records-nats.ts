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
import { eventIdFor } from './derived-id.ts';
import type { IntentChange, RecordSink, ReflexFiredRecord } from './records.ts';
import type { WakeRequest } from './wake.ts';

export { eventIdFor };

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
  /** Publish attempts per reflex or wake record before it is dropped and logged; default 5. */
  attempts?: number;
  /** First retry delay in ms, doubling each time up to maxRetryDelayMs; default 200. */
  retryDelayMs?: number;
  /** Longest wait between two attempts in ms; default 5000. */
  maxRetryDelayMs?: number;
  /** Records waiting to go out before the queue sheds load; default 10,000. */
  maxPending?: number;
}

/** Minecraft ticks in one world day. */
const TICKS_PER_DAY = 24_000;

/** Longest `detail` in a payload (the schemas' maxLength). */
const DETAIL_LIMIT = 256;

/** Records waiting to go out; past this the queue sheds records rather than growing memory. */
const MAX_PENDING = 10_000;

/** Record types the sink never gives up on: the audit record of decision 0020 (action and receipt). */
const AUDIT_TYPES: ReadonlySet<string> = new Set(['action', 'receipt']);

/** One queued event; udit ones are retried until they are sent. */
interface Queued {
  event: WorldEvent;
  audit: boolean;
}

function clip(text: string | undefined): string | undefined {
  return text === undefined ? undefined : text.slice(0, DETAIL_LIMIT);
}

/**
 * A `RecordSink` that publishes each record as a `WorldEvent` of type `intent`, `action`,
 * `receipt`, `reflex_fired` or `wake` on `geldar.<shard>.<type>`. The sink's methods return at
 * once and never throw: events leave in order through one queue, each retried with capped
 * backoff. `action` and `receipt` records (the audit record, decision 0020) are retried until they
 * are sent; the others give up after `attempts`. When the queue is full the oldest waiting
 * `reflex_fired`, `wake` or `intent` record is dropped first, and an audit record is dropped only
 * when the whole queue is audit records, which is logged as an error and counted in
 * `auditDropped`. `source_event_id` comes from the record (for an action, its `action_id` and
 * `state`), so a retry or a replay is one event to the sink.
 */
export class NatsRecordSink implements RecordSink {
  private readonly opts: NatsSinkOptions;
  private readonly queue: Queued[] = [];
  private inflight = false;
  private draining: Promise<void> | null = null;
  private dropCount = 0;
  private auditDropCount = 0;

  constructor(options: NatsSinkOptions) {
    this.opts = options;
  }

  /** Records dropped so far for any reason after they were valid (queue pressure or give-up). */
  get dropped(): number {
    return this.dropCount;
  }

  /** Audit (`action`, `receipt`) records dropped because the queue was full of audit records. */
  get auditDropped(): number {
    return this.auditDropCount;
  }

  intentChanged(change: IntentChange): void {
    const intent = change.intent;
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
        ...(intent === undefined
          ? {}
          : {
              goal: intent.goal,
              program: intent.program,
              arguments: structuredClone(intent.arguments),
              preconditions: [...(intent.preconditions ?? [])],
              wake_on: [...intent.wake_on],
              limits: { ...intent.limits },
            }),
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

  /**
   * Resolves once every event queued so far has been published or dropped. With NATS down an
   * audit record is retried without end, so a caller that must not hang races this with a timer.
   */
  async flush(): Promise<void> {
    while (this.draining) await this.draining;
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
      const item: Queued = { event, audit: AUDIT_TYPES.has(type) };
      if (!this.makeRoom(item)) return;
      this.queue.push(item);
      this.draining ??= this.drain();
    } catch (error) {
      this.log(`records: dropped ${type} record: ${String(error)}`);
    }
  }

  /** Makes room for `incoming` when the queue is full; false when `incoming` itself is the one dropped. */
  private makeRoom(incoming: Queued): boolean {
    const limit = this.opts.maxPending ?? MAX_PENDING;
    if (this.queue.length + (this.inflight ? 1 : 0) < limit) return true;
    const victim = this.queue.findIndex((q) => !q.audit);
    if (victim >= 0) {
      this.shed(this.queue.splice(victim, 1)[0] as Queued);
      return true;
    }
    if (!incoming.audit) {
      this.shed(incoming);
      return false;
    }
    const oldest = this.queue.shift();
    if (oldest) this.shed(oldest);
    return true;
  }

  private shed(dropped: Queued): void {
    this.dropCount++;
    const { type, source_event_id: id } = dropped.event;
    if (dropped.audit) {
      this.auditDropCount++;
      this.log(
        `records: ERROR dropped audit ${type} ${id}: the queue is full of audit records (${this.auditDropCount} lost so far)`,
      );
    } else {
      this.log(`records: dropped ${type} record, the queue is full of records waiting to send`);
    }
  }

  /** Sends the queue in order, one event at a time. Never rejects. */
  private async drain(): Promise<void> {
    try {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        this.inflight = true;
        await this.send(item);
        this.inflight = false;
      }
    } finally {
      this.inflight = false;
      this.draining = null;
    }
  }

  /**
   * Publishes with capped backoff. An audit record is retried until it is sent; any other gives
   * up (logged) after `attempts`. Never rejects.
   */
  private async send({ event, audit }: Queued): Promise<void> {
    const attempts = audit ? Number.POSITIVE_INFINITY : (this.opts.attempts ?? 5);
    const cap = this.opts.maxRetryDelayMs ?? 5_000;
    let delay = this.opts.retryDelayMs ?? 200;
    const subject = `geldar.${event.shard}.${event.type}`;
    const body = JSON.stringify(event);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.opts.publisher.publish(subject, body, event.source_event_id);
        return;
      } catch (error) {
        if (attempt >= attempts) {
          this.dropCount++;
          this.log(
            `records: dropped ${event.type} ${event.source_event_id} after ${attempts} attempts: ${String(error)}`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay).unref());
        delay = Math.min(delay * 2, cap);
      }
    }
  }
}
