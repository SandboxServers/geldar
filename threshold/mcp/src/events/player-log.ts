import type { SimEvent } from '@geldar/mcp-mock';
import type { PlayerEventLog } from '../ports.ts';

/** Events kept per life in memory (the spec's ring). */
export const RING_CAPACITY = 1000;

/** Most stream messages a backfill may read in one `since` call (spec 5.15.3). */
export const BACKFILL_LIMIT = 20_000;

/** Reads one life's events from the stream after `afterSeq`, oldest first, at most `limit`. */
export type Backfill = (lifeId: string, afterSeq: number, limit: number) => Promise<SimEvent[]>;

interface LifeRing {
  /** Retained events, oldest first; each `seq` is the stream sequence. */
  events: SimEvent[];
  /** Seqs that left the ring, oldest first, at most BACKFILL_LIMIT of them. */
  evicted: number[];
}

/**
 * The per-life event log `wait` reads. The cursor is the stream sequence, so an event is keyed by
 * the sequence it has in the stream. A cursor older than the ring is served by a bounded backfill;
 * whatever the backfill does not return is counted in `dropped`.
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
    const newest = ring.events[ring.events.length - 1];
    // A sequence already held is ignored: the stream redelivers after a restart.
    if (newest !== undefined && event.seq <= newest.seq) return;
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
    const kept = ring.events.filter((e) => e.seq > cursor);
    return { events: [...older, ...kept], dropped: Math.max(0, lostAfter.length - older.length) };
  }

  private ringOf(lifeId: string): LifeRing {
    let ring = this.rings.get(lifeId);
    if (ring === undefined) {
      ring = { events: [], evicted: [] };
      this.rings.set(lifeId, ring);
    }
    return ring;
  }
}
