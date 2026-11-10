import type { SimEvent } from '@geldar/mcp-mock';
import type { PlayerEventLog } from '../ports.ts';

/** Events kept per life in memory (the spec's ring). */
export const RING_CAPACITY = 1000;

/** Most stream messages a backfill may read in one `since` call (spec 5.15.3). */
export const BACKFILL_LIMIT = 20_000;

/** Most plan_result entries kept per life, outside the ring, for the thoughts still waiting on them. */
export const PLAN_RESULT_LIMIT = 256;

/** Reads one life's events from the stream after `afterSeq`, oldest first, at most `limit`. */
export type Backfill = (lifeId: string, afterSeq: number, limit: number) => Promise<SimEvent[]>;

interface LifeRing {
  /** Retained events, oldest first; each `seq` is the stream sequence. */
  events: SimEvent[];
  /** Seqs that left the ring, oldest first, at most BACKFILL_LIMIT of them. */
  evicted: number[];
  /** The newest plan_result per thought, oldest first, at most PLAN_RESULT_LIMIT; never in the ring. */
  plans: Map<string, SimEvent>;
}

/**
 * The per-life event log `wait` reads. The cursor is the stream sequence, so an event is keyed by
 * the sequence it has in the stream. A cursor older than the ring is served by a bounded backfill;
 * whatever the backfill does not return is counted in `dropped`. A plan_result is kept beside the
 * ring, so the thought it answers can read it without the ring's events being pushed out by it.
 */
export class RingEventLog implements PlayerEventLog {
  private readonly rings = new Map<string, LifeRing>();
  private readonly backfill: Backfill | undefined;
  private readonly capacity: number;

  constructor(options: { backfill?: Backfill; capacity?: number } = {}) {
    this.backfill = options.backfill;
    this.capacity = options.capacity ?? RING_CAPACITY;
  }

  async append(lifeId: string, event: SimEvent): Promise<void> {
    const ring = this.ringOf(lifeId);
    const thought = event.kind === 'plan_result' ? event.thought_id : undefined;
    if (event.kind === 'plan_result' && thought !== undefined) {
      if (ring.plans.get(thought)?.seq === event.seq) return;
      ring.plans.delete(thought);
      ring.plans.set(thought, event);
      const oldest = ring.plans.keys().next().value;
      if (ring.plans.size > PLAN_RESULT_LIMIT && oldest !== undefined) ring.plans.delete(oldest);
      return;
    }
    const newest = ring.events[ring.events.length - 1];
    // A sequence already held is ignored: the stream redelivers after a restart. One stream message
    // may map to two entries of different kinds, so a kind not yet held at that seq is kept.
    if (newest !== undefined && event.seq < newest.seq) return;
    if (newest !== undefined && event.seq === newest.seq) {
      const held = ring.events.some((e) => e.seq === event.seq && e.kind === event.kind);
      if (held) return;
    }
    ring.events.push(event);
    if (ring.events.length > this.capacity) {
      const gone = ring.events.shift();
      if (gone !== undefined) ring.evicted.push(gone.seq);
      if (ring.evicted.length > BACKFILL_LIMIT) ring.evicted.shift();
    }
  }

  async since(lifeId: string, cursor: number): Promise<{ events: SimEvent[]; dropped: number }> {
    const ring = this.ringOf(lifeId);
    const oldest = ring.events[0]?.seq;
    const lostAfter = ring.evicted.filter((seq) => seq > cursor);
    let older: SimEvent[] = [];
    if (lostAfter.length > 0 && this.backfill !== undefined) {
      const read = await this.backfill(lifeId, cursor, BACKFILL_LIMIT);
      older = read.filter((e) => e.seq > cursor && (oldest === undefined || e.seq < oldest));
    }
    const plans = [...ring.plans.values()].filter((e) => e.seq > cursor);
    const kept = ring.events.filter((e) => e.seq > cursor);
    const events = inSeqOrder([...older, ...plans, ...kept]);
    return { events, dropped: Math.max(0, lostAfter.length - older.length) };
  }

  /** The newest sequence the life holds, 0 when none; a cursor with no value starts here. */
  head(lifeId: string): number {
    const ring = this.ringOf(lifeId);
    const plansHead = Math.max(0, ...[...ring.plans.values()].map((e) => e.seq));
    return Math.max(ring.events.at(-1)?.seq ?? 0, plansHead);
  }

  private ringOf(lifeId: string): LifeRing {
    let ring = this.rings.get(lifeId);
    if (ring === undefined) {
      ring = { events: [], evicted: [], plans: new Map() };
      this.rings.set(lifeId, ring);
    }
    return ring;
  }
}

/** The events in sequence order, one per seq and kind; the sort is stable, so a sequence keeps its order. */
function inSeqOrder(events: SimEvent[]): SimEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = `${e.seq}:${e.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.seq - b.seq);
}
