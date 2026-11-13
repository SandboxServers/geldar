import type { Intent } from '@geldar/contract';
import { Vec3 } from 'vec3';
import {
  type BlueprintName,
  blueprintCells,
  isBlueprintName,
} from '../../actions/build/blueprints.ts';
import { REPLACEABLE } from '../../actions/place.ts';
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
  /** Index in build order of the next cell of the first pass; cells before it are settled. */
  next: number;
  /** Cells the first pass could not place, in build order: the retry pass works through them. */
  deferred: number[];
  /** True once the retry pass has begun; a refused cell then counts as unplaced. */
  retried: boolean;
  /** Blocks this run placed. */
  placed: number;
  /** Cells that already held a solid block, so they serve as wall. */
  solid: number;
  /** Cells still refused after the retry pass. */
  unplaced: number;
  /** The first refusal seen, as `reason: message`. */
  firstFailure: string | null;
}

/**
 * `build`: puts up a named blueprint (`shelter`, `wall`, `pillar`) of one block the body holds,
 * through `place`, lowest layer first. Arguments: `{ blueprint, block }`. Offsets are relative to
 * the cell the body stood in at the start. When the next cell is the body's own, it steps aside
 * first. A cell that already holds a solid block counts as done. A cell refused as `blocked` or
 * `timeout` is deferred: after the last cell one retry pass runs over the deferred cells, and the intent fails
 * only if some cell is still refused. Checkpoint: the blueprint, block, origin, `next`, the
 * deferred cells, the retry flag and the counts; a cell in an old checkpoint before `next` counts
 * as placed. Out of blocks wakes the Mind (`precondition_failed`) and says how many are missing;
 * any other refusal fails the intent with the step number.
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
      deferred: [],
      retried: false,
      placed: 0,
      solid: 0,
      unplaced: 0,
      firstFailure: null,
    };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const cells = blueprintCells(state.blueprint);
    for (let acted = 0; acted < BATCH; ) {
      if (ctx.signal.aborted) return { status: 'running' };
      const retrying = state.next >= cells.length;
      const index = retrying ? state.deferred[0] : state.next;
      const cell = index === undefined ? undefined : cells[index];
      if (index === undefined || !cell) return this.finish(cells.length);
      if (retrying) state.retried = true;
      const at = {
        x: state.origin.x + cell.dx,
        y: state.origin.y + cell.dy,
        z: state.origin.z + cell.dz,
      };
      if (isSolid(ctx.bot.blockAt(new Vec3(at.x, at.y, at.z)))) {
        state.solid++;
        settle(state, retrying);
        continue;
      }
      const aside = await this.stepAside(ctx, at, cells);
      if (aside) return aside;
      const run = await runStepAction(ctx, { do: 'place', block: state.block, at });
      if (run.state === 'completed') {
        state.placed++;
        acted++;
        settle(state, retrying);
        continue;
      }
      const stop = stopOf(run);
      if (stop?.status === 'running') return stop;
      const reason = run.result.reason ?? 'internal';
      const message = run.result.message ?? 'action failed';
      if (reason === 'missing_materials') {
        const missing = this.pending(cells.length) - ctx.view.inventoryCount(state.block);
        return {
          status: 'wake',
          reason: 'precondition_failed',
          message: `${this.progress(cells.length)} Out of ${state.block}: ${missing} more needed.`,
        };
      }
      if (reason !== 'blocked' && reason !== 'timeout') {
        return {
          status: 'failed',
          message: `${this.progress(cells.length)} Stopped at step ${index + 1}: ${reason}: ${message}`,
        };
      }
      state.firstFailure ??= `${reason}: ${message}`;
      if (!retrying) state.deferred.push(index);
      else state.unplaced++;
      settle(state, retrying);
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    const s = this.state;
    return s
      ? {
          blueprint: s.blueprint,
          block: s.block,
          origin: { ...s.origin },
          next: s.next,
          deferred: [...s.deferred],
          retried: s.retried,
          placed: s.placed,
          solid: s.solid,
          unplaced: s.unplaced,
          firstFailure: s.firstFailure,
        }
      : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    // The fields added after the first checkpoint format are read by hand, so that an old
    // checkpoint without them still resumes; the reader sees only the fields it knows.
    const { deferred, retried, firstFailure, ...core } = saved;
    const reader = checkpointReader('build', core);
    const blueprint = reader.name('blueprint');
    const block = reader.name('block');
    const origin = reader.position('origin');
    const next = reader.int('next', 0, 512);
    const placed = reader.optionalInt('placed', 0, 512, next);
    const solid = reader.optionalInt('solid', 0, 512, 0);
    const unplaced = reader.optionalInt('unplaced', 0, 512, 0);
    reader.done();
    if (!isBlueprintName(blueprint)) {
      throw new ProgramError('invalid_args', 'build', `unknown blueprint ${blueprint}`);
    }
    this.state = {
      blueprint,
      block,
      origin,
      next,
      deferred: readDeferred(deferred, blueprintCells(blueprint).length),
      retried: retried === true,
      placed,
      solid,
      unplaced,
      firstFailure: typeof firstFailure === 'string' ? firstFailure : null,
    };
  }

  /** Cells not yet placed or settled: the rest of the first pass plus the deferred cells. */
  private pending(total: number): number {
    const state = this.need();
    return total - state.next + state.deferred.length;
  }

  /** The fixed progress text: `Built shelter: 9 placed, 12 already solid, of 23.` */
  private progress(total: number): string {
    const state = this.need();
    return `Built ${state.blueprint}: ${state.placed} placed, ${state.solid} already solid, of ${total}.`;
  }

  /** Done when every cell is placed or solid; otherwise it names the cells still refused. */
  private finish(total: number): StepResult {
    const state = this.need();
    if (state.unplaced === 0) {
      return { status: 'completed', detail: { message: this.progress(total) } };
    }
    return {
      status: 'failed',
      message: `${this.progress(total)} ${state.unplaced} cells could not be placed; first failure: ${state.firstFailure ?? 'unknown'}.`,
    };
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
      return {
        status: 'failed',
        message: `${this.progress(cells.length)} No room to step aside.`,
      };
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

/** A block that stops a placement: not replaceable, and with a collision box. */
function isSolid(block: { name: string; boundingBox?: string } | null | undefined): boolean {
  return (
    block !== null &&
    block !== undefined &&
    !REPLACEABLE.has(block.name) &&
    block.boundingBox !== 'empty'
  );
}

/** Moves past the cell just settled: the first pass advances, the retry pass drops it. */
function settle(state: BuildState, retrying: boolean): void {
  if (retrying) state.deferred.shift();
  else state.next++;
}

/** The deferred cell list from a checkpoint: absent is empty; anything else must be valid. */
function readDeferred(raw: unknown, cellCount: number): number[] {
  if (raw === undefined) return [];
  const valid =
    Array.isArray(raw) &&
    raw.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < cellCount);
  if (!valid) throw new ProgramError('invalid_args', 'build', 'deferred must list cell numbers');
  return raw as number[];
}
