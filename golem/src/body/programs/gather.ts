import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader } from './args.ts';

/** Most blocks one step mines, so a step stays a bounded slice of work. */
const BATCH = 8;
const MAX_COUNT = 2304;
const MAX_RADIUS = 64;

/** The item a block drops, from the registry; the block's own name when the registry says nothing. */
function dropOf(ctx: ProgramContext, block: string): string {
  const registry = ctx.bot.registry;
  const info = Object.hasOwn(registry.blocksByName, block)
    ? registry.blocksByName[block]
    : undefined;
  for (const entry of info?.drops ?? []) {
    const id =
      typeof entry === 'number'
        ? entry
        : typeof entry.drop === 'number'
          ? entry.drop
          : entry.drop.id;
    const name = registry.items[id]?.name;
    if (name) return name;
  }
  return block;
}

/** True when a `block` lies within `radius` blocks of the Body (an unknown block name is not checked). */
function nearby(ctx: ProgramContext, block: string, radius: number): boolean {
  const info = ctx.bot.registry.blocksByName[block];
  if (!info) return true;
  return ctx.bot.findBlock({ matching: info.id, maxDistance: radius }) !== null;
}

interface GatherState {
  block: string;
  item: string;
  /** Search bound in blocks (the spec's radius), or null for the mine action's own bound. */
  radius: number | null;
  /** The inventory count of `item` that ends the run: the count at start plus the asked amount. */
  goal: number;
}

/**
 * `gather`: mine a block until the inventory holds a number more of its item. Arguments:
 * `{ block, count, item?, radius? }`; `item` is what the block drops when that differs from its
 * name; left out it is the first item the registry lists in the block's `drops` (`stone` drops
 * `cobblestone`). `radius` (1 to 64) bounds the search: no such block within it is `not_found`.
 * Each step mines up to 8 blocks and completes in the same step when the inventory reaches the
 * goal. Checkpoint: `{ block, item, goal, radius? }`; the remaining count is always `goal` minus
 * the inventory, so a resumed run never mines what an earlier run already collected.
 */
export class GatherProgram implements IntentProgram {
  readonly name = 'gather';
  private state: GatherState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('gather', args);
    const block = reader.name('block');
    const count = reader.int('count', 1, MAX_COUNT);
    const given = reader.optionalName('item', '');
    const radius = reader.optionalInt('radius', 1, MAX_RADIUS, 0);
    reader.done();
    const item = given === '' ? dropOf(ctx, block) : given;
    this.state = {
      block,
      item,
      radius: radius === 0 ? null : radius,
      goal: ctx.view.inventoryCount(item) + count,
    };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const have = ctx.view.inventoryCount(state.item);
    const remaining = state.goal - have;
    if (remaining <= 0) {
      return { status: 'completed', detail: { item: state.item, have } };
    }
    if (state.radius !== null && !nearby(ctx, state.block, state.radius)) {
      return { status: 'failed', message: `not_found: no ${state.block} within ${state.radius}` };
    }
    const run = await runStepAction(ctx, {
      do: 'mine',
      block: state.block,
      count: Math.min(remaining, BATCH, 256),
    });
    const stop = stopOf(run);
    if (stop) return stop;
    const now = ctx.view.inventoryCount(state.item);
    if (now <= have) {
      return {
        status: 'failed',
        message: `not_possible: mining ${state.block} did not add ${state.item} to the inventory`,
      };
    }
    // Decide completion here, so a run that reaches its goal on the very block that spends the
    // intent's block-operation limit ends completed, not failed by the limit check on the next tick.
    if (now >= state.goal) return { status: 'completed', detail: { item: state.item, have: now } };
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    if (!this.state) return null;
    const { radius, ...rest } = this.state;
    return radius === null ? rest : { ...rest, radius };
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('gather', saved);
    const block = reader.name('block');
    const item = reader.name('item');
    const goal = reader.int('goal', 1, 1_000_000);
    const radius = reader.optionalInt('radius', 1, MAX_RADIUS, 0);
    reader.done();
    this.state = { block, item, goal, radius: radius === 0 ? null : radius };
  }

  private need(): GatherState {
    if (!this.state) throw new Error('gather was not started');
    return this.state;
  }
}
