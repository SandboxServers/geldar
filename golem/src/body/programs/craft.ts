import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader } from './args.ts';

/** Most items one step crafts (the `craft` action takes up to 64). */
const BATCH = 16;
const MAX_COUNT = 576;

interface CraftState {
  item: string;
  /** The inventory count of `item` that ends the run: the count at start plus the asked amount. */
  goal: number;
}

/**
 * `craft`: make a number of an item, in batches. Arguments: `{ item, count }`. Each step crafts up
 * to 16 items. Checkpoint: `{ item, goal }`; the remaining count is `goal` minus the inventory, so
 * a resumed run does not craft again what is already made. A missing ingredient or station wakes
 * the Mind with `precondition_failed`.
 */
export class CraftProgram implements IntentProgram {
  readonly name = 'craft';
  private state: CraftState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('craft', args);
    const item = reader.name('item');
    const count = reader.int('count', 1, MAX_COUNT);
    reader.done();
    this.state = { item, goal: ctx.view.inventoryCount(item) + count };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const have = ctx.view.inventoryCount(state.item);
    const remaining = state.goal - have;
    if (remaining <= 0) {
      return { status: 'completed', detail: { item: state.item, have } };
    }
    const run = await runStepAction(ctx, {
      do: 'craft',
      item: state.item,
      count: Math.min(remaining, BATCH),
    });
    const stop = stopOf(run);
    if (stop) return stop;
    if (ctx.view.inventoryCount(state.item) <= have) {
      return { status: 'failed', message: `not_possible: crafting ${state.item} made none` };
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    return this.state ? { ...this.state } : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('craft', saved);
    const item = reader.name('item');
    const goal = reader.int('goal', 1, 1_000_000);
    reader.done();
    this.state = { item, goal };
  }

  private need(): CraftState {
    if (!this.state) throw new Error('craft was not started');
    return this.state;
  }
}
