import type { ActionOutcomePayload, ActionRecord, Receipt, Snapshot } from '@geldar/contract';
import type { IntentChange, RecordSink, ReflexFiredRecord } from '../body/records.ts';
import type { WakeRequest } from '../body/wake.ts';

/** The most events the digest keeps; the oldest go first (the snapshot cap). */
export const DIGEST_SIZE = 100;
/** A health drop of at least this much is an event. */
export const HEALTH_DROP_MIN = 2;
/** Longest detail text kept in a digest entry. */
const DETAIL_CHARS = 200;

/** One entry of `events_since_last_thought`. */
export type DigestEvent = Snapshot['events_since_last_thought'][number];

/**
 * A `RecordSink` decorator that passes every record to the sink it wraps and keeps a bounded digest
 * of what the Mind should hear about on its next thought: action ends, intent ends, reflex firings,
 * wakes and health drops of 2 or more. `drainEvents()` returns the digest and clears it.
 */
export class RecentEvents implements RecordSink {
  private events: DigestEvent[] = [];
  private lastHealth: number | null = null;

  private readonly inner: RecordSink;

  constructor(inner: RecordSink) {
    this.inner = inner;
  }

  intentChanged(change: IntentChange): void {
    this.inner.intentChanged(change);
    if (change.state === 'accepted' || change.state === 'running' || change.state === 'paused') {
      return;
    }
    this.push({
      type: 'intent_ended',
      intent_id: change.intentId,
      state: change.state,
      tick: change.tick,
      ...detailOf(change.detail),
    });
  }

  actionChanged(record: ActionRecord): void {
    this.inner.actionChanged(record);
    if (record.state === 'accepted' || record.state === 'running') return;
    const result = record.result as { reason?: unknown; message?: unknown } | null;
    this.push({
      type: 'action_ended',
      action_id: record.action_id,
      kind: record.kind,
      state: record.state,
      ...(typeof result?.reason === 'string' ? { reason: result.reason } : {}),
      ...detailOf(typeof result?.message === 'string' ? result.message : undefined),
    });
  }

  receipt(receipt: Receipt): void {
    this.inner.receipt(receipt);
  }

  reflexFired(record: ReflexFiredRecord): void {
    this.inner.reflexFired(record);
    this.push({
      type: 'reflex_fired',
      name: record.name,
      result: record.outcome.result,
      tick: record.tick,
      ...detailOf(record.outcome.detail),
    });
  }

  wake(request: WakeRequest): void {
    this.inner.wake(request);
    this.push({
      type: 'wake',
      reason: request.reason,
      tick: request.tick,
      ...detailOf(request.detail),
    });
  }

  actionOutcome(payload: ActionOutcomePayload, tick: number): void {
    this.inner.actionOutcome?.(payload, tick);
  }

  /**
   * The Body's health after a change. A drop of 2 or more since the last reading is an event; the
   * first reading and any rise only set the baseline.
   */
  noteHealth(health: number, tick: number): void {
    const before = this.lastHealth;
    this.lastHealth = health;
    if (before !== null && before - health >= HEALTH_DROP_MIN) {
      this.push({ type: 'health_drop', from: before, to: health, tick });
    }
  }

  /** The digest, oldest first, at most 100 entries. Does not clear it. */
  peekEvents(): Snapshot['events_since_last_thought'] {
    return [...this.events];
  }

  /** Drops the oldest `count` entries: the ones a snapshot carried once it was sent. */
  ackEvents(count: number): void {
    this.events.splice(0, count);
  }

  /** The digest, oldest first, at most 100 entries. Clears it. */
  drainEvents(): Snapshot['events_since_last_thought'] {
    const out = this.peekEvents();
    this.ackEvents(out.length);
    return out;
  }

  private push(event: DigestEvent): void {
    this.events.push(event);
    if (this.events.length > DIGEST_SIZE) this.events.splice(0, this.events.length - DIGEST_SIZE);
  }
}

/** A `detail` field cut to the digest limit, or nothing. */
function detailOf(text: string | undefined): { detail?: string } {
  return text ? { detail: text.slice(0, DETAIL_CHARS) } : {};
}
