import type { CharacterSheet, SheetAdoptedPayload, WorldEvent } from '@geldar/contract';
import type { DrawKey, Roll } from '@geldar/psyche';
import type { EventPublisher } from '../body/records-nats.ts';
import {
  type AuditEnvelope,
  adoptionRecord,
  type BuiltEvent,
  type DecisionFields,
  decisionRecord,
  gapRecord,
  rollEventId,
  rollRecord,
} from './audit-events.ts';

/** Waiting records before the oldest is dropped (the D-CS-07 number; unmeasured). */
const DEFAULT_MAX_PENDING = 2000;

/** Failed attempts of one event between two log lines (the first failure is always logged). */
const RETRY_LOG_EVERY = 20;

export interface AuditPublisherOptions {
  publisher: EventPublisher;
  shard: string;
  lifeId: string;
  generation: number;
  tick: () => number;
  now?: () => Date;
  maxPending?: number;
  /** First retry delay in ms, doubling up to maxRetryDelayMs; default 200 (as NatsRecordSink). */
  retryDelayMs?: number;
  /** Longest wait between two attempts in ms; default 5000 (as NatsRecordSink). */
  maxRetryDelayMs?: number;
  log: (line: string) => void;
}

/** A run of dropped records not yet reported by a gap event. */
interface Gap {
  count: number;
  since: number;
}

/** Joins a run that failed to report with the runs that gathered since: the earliest tick wins. */
function mergeGap(later: Gap | null, earlier: Gap): Gap {
  if (!later) return earlier;
  return { count: later.count + earlier.count, since: Math.min(later.since, earlier.since) };
}

/**
 * The Body's audit producer. Each call builds one event with a stable id (so a retry or a restart
 * that replays a key is one event in the stream), queues it and returns at once: a fleeing Body
 * never waits on audit. One background loop publishes the queue in order, retrying each event with
 * capped backoff until it is sent. When the queue is at `maxPending`, the oldest waiting event is
 * dropped and counted; after the next successful publish, one `audit_gap` decision reports the count
 * and the first dropped tick. No call throws: an invalid record is dropped and logged.
 */
export class AuditPublisher {
  private readonly opts: AuditPublisherOptions;
  private readonly maxPending: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly now: () => Date;
  private readonly queue: WorldEvent[] = [];
  private draining: Promise<void> | null = null;
  private dropped = 0;
  private gap: Gap | null = null;

  constructor(options: AuditPublisherOptions) {
    this.opts = options;
    this.maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
  }

  /** Records dropped so far because the queue was full (each one is a gap in the audit trail). */
  get gaps(): number {
    return this.dropped;
  }

  /**
   * Queues a roll. Returns the roll's stable event id (the id a decision cites), or '' when the key
   * itself is not valid. A roll that fails validation is dropped and logged; its id is still returned.
   */
  recordRoll(
    key: DrawKey,
    roll: Roll,
    drawIndex: number,
    inputs?: Record<string, string | number | boolean | null>,
  ): string {
    let id = '';
    try {
      id = rollEventId(key, drawIndex);
      this.enqueue(rollRecord(this.envelope(key.tick), key, roll, drawIndex, inputs), 'roll');
    } catch (error) {
      this.opts.log(`audit: dropped roll: ${String(error)}`);
    }
    return id;
  }

  /** Queues a decision for one draw; the decision id and the engine version come from the key. */
  recordDecision(key: DrawKey, fields: DecisionFields): void {
    try {
      this.enqueue(decisionRecord(this.envelope(key.tick), key, fields), 'decision');
    } catch (error) {
      this.opts.log(`audit: dropped decision: ${String(error)}`);
    }
  }

  /** Queues the adoption of a sheet by this life. */
  recordAdoption(sheet: CharacterSheet, hash: string, source: SheetAdoptedPayload['source']): void {
    try {
      const ctx = this.envelope(this.opts.tick());
      this.enqueue(adoptionRecord(ctx, sheet, hash, source), 'sheet_adopted');
    } catch (error) {
      this.opts.log(`audit: dropped sheet_adopted: ${String(error)}`);
    }
  }

  /** Resolves once the queue is empty and nothing is in flight (it waits through retries). */
  async flush(): Promise<void> {
    while (this.draining !== null) await this.draining;
  }

  private envelope(tick: number): AuditEnvelope {
    return {
      shard: this.opts.shard,
      lifeId: this.opts.lifeId,
      tick,
      at: this.now().toISOString(),
    };
  }

  private enqueue(built: BuiltEvent, what: string): void {
    if (!built.ok) {
      this.opts.log(`audit: dropped ${what}: ${built.errors.join('; ')}`);
      return;
    }
    if (this.queue.length >= this.maxPending) this.dropOldest();
    this.queue.push(built.event);
    this.kick();
  }

  private dropOldest(): void {
    const oldest = this.queue.shift();
    if (!oldest) return;
    this.dropped++;
    this.gap = this.gap
      ? { count: this.gap.count + 1, since: this.gap.since }
      : { count: 1, since: oldest.world_tick };
  }

  /**
   * Starts the drain loop when it is idle. The first `await` in `run` comes before `run` can reach
   * its reset of `draining`, so the assignment below always lands before that reset.
   */
  private kick(): void {
    if (this.draining === null) this.draining = this.run();
  }

  private async run(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift() as WorldEvent;
      await this.deliver(next);
      await this.reportGap();
    }
    this.draining = null;
  }

  private publishEvent(event: WorldEvent): Promise<void> {
    const subject = `geldar.${event.shard}.${event.type}`;
    return this.opts.publisher.publish(subject, JSON.stringify(event), event.source_event_id);
  }

  /** Publishes one event, retrying with capped backoff until it is sent. Never rejects. */
  private async deliver(event: WorldEvent): Promise<void> {
    let delay = this.retryDelayMs;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.publishEvent(event);
        return;
      } catch (error) {
        if (attempt === 1 || attempt % RETRY_LOG_EVERY === 0) {
          this.opts.log(
            `audit: ${event.type} ${event.source_event_id} not sent, attempt ${attempt}, retrying: ${String(error)}`,
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay).unref());
        delay = Math.min(delay * 2, this.maxRetryDelayMs);
      }
    }
  }

  /** After a successful publish, reports the dropped run once; a failed report is merged back. */
  private async reportGap(): Promise<void> {
    const window = this.gap;
    if (!window) return;
    this.gap = null;
    const built = gapRecord(
      this.envelope(this.opts.tick()),
      this.opts.generation,
      this.dropped,
      window.count,
      window.since,
    );
    if (!built.ok) {
      this.opts.log(`audit: gap evidence refused: ${built.errors.join('; ')}`);
      return;
    }
    try {
      await this.publishEvent(built.event);
    } catch (error) {
      this.gap = mergeGap(this.gap, window);
      this.opts.log(
        `audit: gap evidence not sent, will retry after the next publish: ${String(error)}`,
      );
    }
  }
}
