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
  /** The producer of this Body's keys; default 'body'. A key from another producer is refused. */
  producer?: DrawKey['producer'];
  tick: () => number;
  now?: () => Date;
  maxPending?: number;
  /** First retry delay in ms, doubling up to maxRetryDelayMs; default 200 (as NatsRecordSink). */
  retryDelayMs?: number;
  /** Longest wait between two attempts in ms; default 5000 (as NatsRecordSink). */
  maxRetryDelayMs?: number;
  log: (line: string) => void;
}

/**
 * A run of dropped records not yet reported by a gap event. `report` pins the gap event's id (the
 * tick and the running drop count of its first attempt), so a resend with no new drop keeps the id.
 */
interface Gap {
  count: number;
  since: number;
  report?: { n: number; tick: number };
}

/**
 * Joins a run that failed to report with the runs that gathered since: the earliest tick wins. The
 * merged run has no pinned id, because its drop count has changed. When nothing gathered, `later` is
 * null and the failed run is returned as it was, pin included.
 */
function mergeGap(later: Gap | null, earlier: Gap): Gap {
  if (!later) return earlier;
  return { count: later.count + earlier.count, since: Math.min(later.since, earlier.since) };
}

/**
 * The Body's audit producer. Each call builds one event with a stable id (so a retry or a restart
 * that replays a key is one event in the stream), queues it and returns at once: a fleeing Body
 * never waits on audit. One background loop publishes the queue in order, retrying each event with
 * capped backoff until it is sent or the publisher is closed. When the queue is at `maxPending`, the
 * oldest waiting event is dropped and counted; after the next successful publish, one `audit_gap`
 * decision reports the count and the first dropped tick. No call throws: an invalid record is
 * dropped and logged, and a failing gap report or clock never stops the loop.
 */
export class AuditPublisher {
  private readonly opts: AuditPublisherOptions;
  private readonly producer: DrawKey['producer'];
  private readonly maxPending: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly now: () => Date;
  private readonly queue: WorldEvent[] = [];
  private draining: Promise<void> | null = null;
  private current: WorldEvent | null = null;
  private dropped = 0;
  private gap: Gap | null = null;
  private closed = false;
  private wake: (() => void) | null = null;

  constructor(options: AuditPublisherOptions) {
    this.opts = options;
    this.producer = options.producer ?? 'body';
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
      this.checkKey(key);
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
      this.checkKey(key);
      this.enqueue(decisionRecord(this.envelope(key.tick), key, fields), 'decision');
    } catch (error) {
      this.opts.log(`audit: dropped decision: ${String(error)}`);
    }
  }

  /** Queues the adoption of a sheet by this life (the life comes from the options, not a key). */
  recordAdoption(sheet: CharacterSheet, hash: string, source: SheetAdoptedPayload['source']): void {
    try {
      const ctx = this.envelope(this.opts.tick());
      this.enqueue(adoptionRecord(ctx, sheet, hash, source), 'sheet_adopted');
    } catch (error) {
      this.opts.log(`audit: dropped sheet_adopted: ${String(error)}`);
    }
  }

  /**
   * Resolves true once the queue is empty, nothing is in flight and no gap is pending. A pending gap
   * gets one report attempt here. Resolves false when a gap still fails, when the publisher is closed
   * with records waiting, or, with `timeoutMs`, when that long passes first.
   */
  flush(timeoutMs?: number): Promise<boolean> {
    const idle = this.settle();
    if (timeoutMs === undefined) return idle;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, false);
    });
    return Promise.race([idle, expired]).finally(() => clearTimeout(timer));
  }

  /**
   * Stops the retry loop and its wait timer. Nothing more is sent, and records queued after this are
   * dropped and logged. The events still waiting are counted in one log line, not dropped silently.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiting = this.queue.length + (this.current ? 1 : 0);
    this.opts.log(
      `audit: closed; ${waiting} event(s) not sent, ${this.gap?.count ?? 0} dropped record(s) unreported`,
    );
    this.wake?.();
  }

  private async settle(): Promise<boolean> {
    for (;;) {
      while (this.draining !== null) await this.draining;
      if (this.queue.length > 0 || this.current) return false;
      if (!this.gap) return true;
      if (this.closed) return false;
      await this.reportGap();
      if (this.gap) return false;
    }
  }

  private envelope(tick: number): AuditEnvelope {
    return {
      shard: this.opts.shard,
      lifeId: this.opts.lifeId,
      tick,
      at: this.now().toISOString(),
    };
  }

  /** A key of another life, generation or producer would label its record with the wrong Body. */
  private checkKey(key: DrawKey): void {
    if (
      key.lifeId !== this.opts.lifeId ||
      key.generation !== this.opts.generation ||
      key.producer !== this.producer
    ) {
      throw new Error(
        `key ${key.lifeId} generation ${key.generation} producer ${key.producer} is not this Body's`,
      );
    }
  }

  private enqueue(built: BuiltEvent, what: string): void {
    if (this.closed) {
      this.opts.log(`audit: dropped ${what}: publisher closed`);
      return;
    }
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

  /** The drain loop. It never rejects, and its reset of `draining` runs however it ends. */
  private async run(): Promise<void> {
    try {
      while (this.queue.length > 0 && !this.closed) {
        const next = this.queue.shift() as WorldEvent;
        this.current = next;
        const sent = await this.deliver(next);
        if (!sent) return; // `current` stays set: close() left this event unsent
        this.current = null;
        await this.reportGap();
      }
    } finally {
      this.draining = null;
    }
  }

  private publishEvent(event: WorldEvent): Promise<void> {
    const subject = `geldar.${event.shard}.${event.type}`;
    return this.opts.publisher.publish(subject, JSON.stringify(event), event.source_event_id);
  }

  /**
   * Publishes one event, retrying with capped backoff until it is sent (true) or the publisher is
   * closed first (false, logged).
   */
  private async deliver(event: WorldEvent): Promise<boolean> {
    let delay = this.retryDelayMs;
    for (let attempt = 1; !this.closed; attempt++) {
      try {
        await this.publishEvent(event);
        return true;
      } catch (error) {
        if (attempt === 1 || attempt % RETRY_LOG_EVERY === 0) {
          this.opts.log(
            `audit: ${event.type} ${event.source_event_id} not sent, attempt ${attempt}, retrying: ${String(error)}`,
          );
        }
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, this.maxRetryDelayMs);
    }
    this.opts.log(`audit: ${event.type} ${event.source_event_id} not sent, publisher closed`);
    return false;
  }

  /** Waits `ms`, or returns at once when the publisher is closed. The timer is unref'd. */
  private sleep(ms: number): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      timer.unref();
      this.wake = finish;
    });
  }

  /**
   * After a successful publish, reports the dropped run once. Never throws: a failed clock, build or
   * send merges the run back, to be reported after the next success or by the next flush.
   */
  private async reportGap(): Promise<void> {
    const window = this.gap;
    if (!window) return;
    this.gap = null;
    try {
      const report = window.report ?? { n: this.dropped, tick: this.opts.tick() };
      const built = gapRecord(
        this.envelope(report.tick),
        this.opts.generation,
        report.n,
        window.count,
        window.since,
      );
      if (!built.ok) {
        this.opts.log(`audit: gap evidence refused: ${built.errors.join('; ')}`);
        return;
      }
      window.report = report;
      await this.publishEvent(built.event);
    } catch (error) {
      this.gap = mergeGap(this.gap, window);
      this.opts.log(
        `audit: gap evidence not sent, will retry after the next publish or flush: ${String(error)}`,
      );
    }
  }
}
