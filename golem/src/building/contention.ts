// Contention with foreground intents (BLD-14). A foreground intent such as `gather` or `travel`
// and a reflex hold the plan lane the same way: while any holder is held the lane is paused, and it
// resumes when the last holder releases. A reflex stays a holder until it ends, so it still
// outranks an intent that ends first. The plan has no priority and no slice share.
import type { PlanLane } from './lane.ts';

/** The lane's pause and resume, as the gate calls them. */
export type ContentionLane = Pick<PlanLane, 'pauseForReflex' | 'resume'>;

/** The holder set in front of the plan lane. */
export class Contention {
  private readonly lane: ContentionLane;
  private readonly holders = new Set<string>();

  constructor(lane: ContentionLane) {
    this.lane = lane;
  }

  /** True while any reflex or foreground intent holds the lane. */
  get held(): boolean {
    return this.holders.size > 0;
  }

  /**
   * Holds the lane for `holder`. The first hold pauses it and resolves once the in-flight cell has
   * ended; a repeated hold by the same holder changes nothing.
   */
  async hold(holder: string): Promise<void> {
    if (this.holders.has(holder)) return;
    const first = this.holders.size === 0;
    this.holders.add(holder);
    if (first) await this.lane.pauseForReflex();
  }

  /** Ends `holder`'s hold. The last release resumes the lane; an unknown holder does nothing. */
  release(holder: string): void {
    if (!this.holders.delete(holder)) return;
    if (this.holders.size === 0) this.lane.resume();
  }
}

/** Creates the gate in front of a plan lane. */
export function contendFor(lane: ContentionLane): Contention {
  return new Contention(lane);
}
