/**
 * The world day and tick a `sovereign_call` envelope is stamped with (WorldEvent requires them).
 * The MCP keeps the newest pair it has seen on the Mind's event stream; the stream replays before
 * the front door listens, so a call made after startup has a stamp.
 */
export interface WorldStamp {
  world_day: number;
  world_tick: number;
}

/** Holds the newest stamp by world tick. Never throws. */
export class WorldClock {
  private stamp: WorldStamp | undefined;

  /** Keeps the stamp of the newest event; an older one never moves the clock back. */
  observe(event: WorldStamp): void {
    if (this.stamp === undefined || event.world_tick >= this.stamp.world_tick) {
      this.stamp = { world_day: event.world_day, world_tick: event.world_tick };
    }
  }

  /** The newest stamp, or undefined before any event has been seen. */
  latest(): WorldStamp | undefined {
    return this.stamp;
  }
}
