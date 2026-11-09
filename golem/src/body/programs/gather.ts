import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader } from './args.ts';

/** Most blocks one step mines, so a step stays a bounded slice of work. */
const BATCH = 8;
const MAX_COUNT = 2304;

interface GatherState {
  block: string;
  item: string;
  /** The inventory count of `item` that ends the run: the count at start plus the asked amount. */
  goal: number;
}

/**
 * `gather`: mine a block until the inventory holds a number more of its item. Arguments:
 * `{ block, count, item? }`; `item` is what the block drops when that differs from its name
 * (`stone` drops `cobblestone`). Each step mines up to 8 blocks. Checkpoint:
 * `{ block, item, goal }`; the remaining count is always `goal` minus the inventory, so a resumed
 * run never mines what an earlier run already collected.
 */
export class GatherProgram implements IntentProgram {
  readonly name = 'gather';
  private state: GatherState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('gather', args);
    const block = reader.name('block');
    const count = reader.int('count', 1, MAX_COUNT);
    const item = reader.optionalName('item', block);
    reader.done();
    this.state = { block, item, goal: ctx.view.inventoryCount(item) + count };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const have = ctx.view.inventoryCount(state.item);
    const remaining = state.goal - have;
    if (remaining <= 0) {
      return { status: 'completed', detail: { item: state.item, have } };
    }
    const run = await runStepAction(ctx, {
      do: 'mine',
      block: state.block,
      count: Math.min(remaining, BATCH, 256),
    });
    const stop = stopOf(run);
    if (stop) return stop;
    if (ctx.view.inventoryCount(state.item) <= have) {
      return {
        status: 'failed',
        message: `not_possible: mining ${state.block} did not add ${state.item} to the inventory`,
      };
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    return this.state ? { ...this.state } : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('gather', saved);
    const block = reader.name('block');
    const item = reader.name('item');
    const goal = reader.int('goal', 1, 1_000_000);
    reader.done();
    this.state = { block, item, goal };
  }

  private need(): GatherState {
    if (!this.state) throw new Error('gather was not started');
    return this.state;
  }
}
