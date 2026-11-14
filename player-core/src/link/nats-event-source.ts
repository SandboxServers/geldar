/**
 * The Mind's event feed (spec 5.2): an ordered JetStream consumer on `GELDAR_EVENTS` that
 * delivers from the moment it starts, keeps the events of the lives that are subscribed, checks
 * each against the contract and hands the Mind `MindEvent`s. Anything that fails the contract is
 * dropped and counted, never repaired.
 */
import { DeliverPolicy, type JetStreamClient } from '@nats-io/jetstream';
import type { EventSource, MindEvent } from '../ports/index.ts';
import { mindEventSubjects, normaliseEvent } from './mind-event.ts';

/** The stream the sink and the Body publish to. */
export const EVENT_STREAM = 'GELDAR_EVENTS';

/** How many delivered event ids the source remembers, so a redelivery is not handed on twice. */
const REMEMBERED_IDS = 4096;

/** One delivered message: its subject and its body text. */
export interface StreamMessage {
  subject: string;
  data: string;
}

/** Where messages come from: an ordered consumer in production, a fake in tests. */
export interface EventStream {
  /**
   * Starts delivering messages on `subjects` that arrive from now on. Resolves once the consumer
   * exists; returns the function that closes it.
   */
  open(subjects: string[], onMessage: (message: StreamMessage) => void): Promise<() => void>;
}

/** An `EventStream` over a JetStream ordered consumer that starts with new messages. */
export function jetStreamEventStream(js: JetStreamClient, stream = EVENT_STREAM): EventStream {
  return {
    async open(subjects, onMessage) {
      const consumer = await js.consumers.get(stream, {
        filter_subjects: subjects,
        deliver_policy: DeliverPolicy.New,
      });
      const messages = await consumer.consume();
      void (async () => {
        for await (const message of messages) {
          onMessage({ subject: message.subject, data: message.string() });
        }
      })().catch((error: unknown) => {
        console.warn(`event source: consumer ended: ${String(error)}`);
      });
      return () => {
        void messages.close();
      };
    },
  };
}

/** What a `NatsEventSource` has seen but not delivered. */
export interface EventSourceCounts {
  /** Messages that fail the contract (not JSON, envelope, payload, or subject and type differ). */
  invalid: number;
  /** Valid events of a life nobody subscribed to, or with no `agent_id`. */
  otherLife: number;
}

/** What a `NatsEventSource` is built from. */
export interface NatsEventSourceOptions {
  stream: EventStream;
  shard: string;
  /** Where dropped messages are reported; default `console.warn`. */
  log?: (line: string) => void;
}

/** The `EventSource` over the event stream. Call `start` once before subscribing matters. */
export class NatsEventSource implements EventSource {
  private readonly opts: NatsEventSourceOptions;
  private readonly handlers = new Map<string, Set<(event: MindEvent) => void>>();
  private readonly seen = new Set<string>();
  private close: (() => void) | null = null;
  private readonly tally: EventSourceCounts = { invalid: 0, otherLife: 0 };

  constructor(options: NatsEventSourceOptions) {
    this.opts = options;
  }

  /** Messages dropped so far. */
  get counts(): Readonly<EventSourceCounts> {
    return this.tally;
  }

  /** Opens the consumer. A second call is a no-op. */
  async start(): Promise<void> {
    if (this.close !== null) return;
    this.close = await this.opts.stream.open(mindEventSubjects(this.opts.shard), (message) =>
      this.receive(message.subject, message.data),
    );
  }

  /** Closes the consumer. Subscriptions stay, but nothing more arrives. */
  stop(): void {
    this.close?.();
    this.close = null;
  }

  subscribe(lifeId: string, handler: (event: MindEvent) => void): () => void {
    const set = this.handlers.get(lifeId) ?? new Set();
    set.add(handler);
    this.handlers.set(lifeId, set);
    return () => {
      set.delete(handler);
    };
  }

  private log(line: string): void {
    (this.opts.log ?? console.warn)(`event source: ${line}`);
  }

  private receive(subject: string, data: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.drop(`${subject}: not JSON`);
      return;
    }
    const result = normaliseEvent(raw);
    if (result.status === 'ignored') return;
    if (result.status === 'invalid') {
      this.drop(`${subject}: ${result.reason}`);
      return;
    }
    if (subject.split('.').pop() !== result.event.type) {
      this.drop(`${subject}: subject does not match type ${result.event.type}`);
      return;
    }
    const targets = result.agentId === null ? undefined : this.handlers.get(result.agentId);
    if (targets === undefined || targets.size === 0) {
      this.tally.otherLife += 1;
      return;
    }
    if (this.seen.has(result.event.eventId)) return;
    this.seen.add(result.event.eventId);
    if (this.seen.size > REMEMBERED_IDS) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    for (const handler of [...targets]) {
      try {
        handler(result.event);
      } catch (error) {
        this.log(`a handler threw on ${result.event.eventId}: ${String(error)}`);
      }
    }
  }

  private drop(why: string): void {
    this.tally.invalid += 1;
    this.log(`dropped ${why}`);
  }
}
