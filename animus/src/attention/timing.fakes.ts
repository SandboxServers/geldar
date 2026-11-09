import type { Clock, Scheduler } from './timing.ts';

/** A clock and scheduler driven by hand: time moves only when `advance` is called. */
export class ManualTiming implements Clock, Scheduler {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  nowMs(): number {
    return this.now;
  }

  after(delayMs: number, callback: () => void): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delayMs, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves time forward by `ms`, running every timer that falls due, earliest first. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let dueId: number | undefined;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueId = id;
          dueAt = t.at;
        }
      }
      if (dueId === undefined) break;
      const timer = this.timers.get(dueId);
      this.timers.delete(dueId);
      this.now = Math.max(this.now, dueAt);
      timer?.callback();
    }
    this.now = target;
  }
}
