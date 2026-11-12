import type { Intent } from '@geldar/contract';
import { Vec3 } from 'vec3';
import {
  type BlueprintName,
  blueprintCells,
  isBlueprintName,
} from '../../actions/build/blueprints.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, ProgramError } from './args.ts';

/** Most blocks one step places before it gives the executor a turn. */
const BATCH = 3;
/** The four steps the body may take aside, in this order. */
const ASIDE = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

interface BuildState {
  blueprint: BlueprintName;
  /** The one block every cell is made of. */
  block: string;
  /** The cell the body stood in at the start: blueprint offsets are relative to it. */
  origin: { x: number; y: number; z: number };
  /** Index in build order of the next cell to place; cells before it are done. */
  next: number;
}

/**
 * `build`: puts up a named blueprint (`shelter`, `wall`, `pillar`) of one block the body holds,
 * through `place`, lowest layer first. Arguments: `{ blueprint, block }`. Offsets are relative to
 * the cell the body stood in at the start. When the next cell is the body's own, it steps aside
 * first. Checkpoint: the blueprint, block, origin and `next`; after a resume, a cell that already
 * holds the block counts as done. Out of blocks wakes the Mind (`precondition_failed`) and says how
 * many are missing; any other refusal fails the intent with the step number.
 */
export class BuildProgram implements IntentProgram {
  readonly name = 'build';
  private state: BuildState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('build', args);
    const blueprint = reader.name('blueprint');
    const block = reader.name('block');
    reader.done();
    if (!isBlueprintName(blueprint)) {
      throw new ProgramError('invalid_args', 'build', `unknown blueprint ${blueprint}`);
    }
    const { x, y, z } = ctx.view.position;
    this.state = {
      blueprint,
      block,
      origin: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
      next: 0,
    };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const cells = blueprintCells(state.blueprint);
    for (let placed = 0; placed < BATCH; ) {
      if (ctx.signal.aborted) return { status: 'running' };
      const cell = cells[state.next];
      if (!cell) {
        return { status: 'completed', detail: { message: this.progress(cells.length) } };
      }
      const at = {
        x: state.origin.x + cell.dx,
        y: state.origin.y + cell.dy,
        z: state.origin.z + cell.dz,
      };
      if (ctx.bot.blockAt(new Vec3(at.x, at.y, at.z))?.name === state.block) {
        state.next++;
        continue;
      }
      const aside = await this.stepAside(ctx, at, cells);
      if (aside) return aside;
      const run = await runStepAction(ctx, { do: 'place', block: state.block, at });
      if (run.state !== 'completed') {
        const stop = stopOf(run);
        if (stop?.status === 'running') return stop;
        const reason = run.result.reason ?? 'internal';
        if (reason === 'missing_materials') {
          const missing = cells.length - state.next - ctx.view.inventoryCount(state.block);
          return {
            status: 'wake',
            reason: 'precondition_failed',
            message: `${this.progress(cells.length)} Out of ${state.block}: ${missing} more needed.`,
          };
        }
        return {
          status: 'failed',
          message: `${this.progress(cells.length)} Stopped at step ${state.next + 1}: ${reason}: ${run.result.message ?? 'action failed'}`,
        };
      }
      state.next++;
      placed++;
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    const s = this.state;
    return s
      ? { blueprint: s.blueprint, block: s.block, origin: { ...s.origin }, next: s.next }
      : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('build', saved);
    const blueprint = reader.name('blueprint');
    const block = reader.name('block');
    const origin = reader.position('origin');
    const next = reader.int('next', 0, 512);
    reader.done();
    if (!isBlueprintName(blueprint)) {
      throw new ProgramError('invalid_args', 'build', `unknown blueprint ${blueprint}`);
    }
    this.state = { blueprint, block, origin, next };
  }

  /** The fixed progress text: `Built shelter: 12 of 23 blocks placed.` */
  private progress(total: number): string {
    const state = this.need();
    return `Built ${state.blueprint}: ${state.next} of ${total} blocks placed.`;
  }

  /**
   * When the cell is the body's feet or head cell, walks the body to the first free neighbour
   * that is not a cell of the blueprint. Returns a step result only when that walk fails.
   */
  private async stepAside(
    ctx: ProgramContext,
    at: { x: number; y: number; z: number },
    cells: readonly { dx: number; dy: number; dz: number }[],
  ): Promise<StepResult | null> {
    const state = this.need();
    const feet = {
      x: Math.floor(ctx.view.position.x),
      y: Math.floor(ctx.view.position.y),
      z: Math.floor(ctx.view.position.z),
    };
    if (at.x !== feet.x || at.z !== feet.z || (at.y !== feet.y && at.y !== feet.y + 1)) return null;
    const inPlan = (x: number, y: number, z: number): boolean =>
      cells.some(
        (c) =>
          state.origin.x + c.dx === x && state.origin.y + c.dy === y && state.origin.z + c.dz === z,
      );
    const free = ASIDE.find((s) => !inPlan(feet.x + s.x, feet.y, feet.z + s.z));
    if (!free)
      return { status: 'failed', message: `${this.progress(cells.length)} No room to step aside.` };
    const target = { x: feet.x + free.x, y: feet.y, z: feet.z + free.z };
    const run = await runStepAction(ctx, { do: 'goto', target });
    if (run.state === 'completed') return null;
    const stop = stopOf(run);
    return stop ?? { status: 'running' };
  }

  private need(): BuildState {
    if (!this.state) throw new Error('build was not started');
    return this.state;
  }
}
