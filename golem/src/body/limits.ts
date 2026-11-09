import type { Action } from '@geldar/contract';

/** An intent's limits (the contract's `limits`, snake_case there). */
export interface IntentLimits {
  maxWorldTicks: number;
  maxBlockOperations: number;
}

/** Which limit ran out. */
export type LimitKind = 'max_world_ticks' | 'max_block_operations';

/**
 * Counts one intent run against its limits. World ticks count from the tick the run started;
 * block operations are added by whoever does them. A limit is reached when its count equals the
 * maximum: `max_world_ticks: 100` allows ticks up to start + 99.
 */
export class LimitTracker {
  private readonly limits: IntentLimits;
  private readonly startTick: number;
  private blockOperations = 0;
  private lastTick: number;

  constructor(limits: IntentLimits, startTick: number) {
    this.limits = limits;
    this.startTick = startTick;
    this.lastTick = startTick;
  }

  /** Records the current world tick. */
  observeTick(tick: number): void {
    this.lastTick = Math.max(this.lastTick, tick);
  }

  /** Adds block operations (mining, placing). Non-positive and non-finite counts are ignored. */
  addBlockOperations(count: number): void {
    if (Number.isFinite(count) && count > 0) this.blockOperations += count;
  }

  /** World ticks used so far. */
  get ticksUsed(): number {
    return this.lastTick - this.startTick;
  }

  /** Block operations used so far. */
  get blockOperationsUsed(): number {
    return this.blockOperations;
  }

  /** The first limit that has run out, or null. World ticks are checked first. */
  exceeded(): LimitKind | null {
    if (this.ticksUsed >= this.limits.maxWorldTicks) return 'max_world_ticks';
    if (this.blockOperations >= this.limits.maxBlockOperations) return 'max_block_operations';
    return null;
  }
}

/** How many block operations one action costs: `mine` its count, `place` one, `build` its blocks. */
export function blockOperationsOf(action: Action): number {
  switch (action.do) {
    case 'mine':
      return action.count;
    case 'place':
      return 1;
    case 'build':
      return action.blueprint.blocks.length;
    default:
      return 0;
  }
}
