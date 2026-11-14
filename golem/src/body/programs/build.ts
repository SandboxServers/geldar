import type { Intent } from '@geldar/contract';
import { Vec3 } from 'vec3';
import {
  type BlueprintName,
  blueprintCells,
  type Cell,
  isBlueprintName,
} from '../../actions/build/blueprints.ts';
import { REPLACEABLE } from '../../actions/place.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { isClosedCell } from '../view.ts';
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
/** The four horizontal sides of the body, north is -z. */
const SIDES = [
  { name: 'north', dx: 0, dz: -1 },
  { name: 'south', dx: 0, dz: 1 },
  { name: 'east', dx: 1, dz: 0 },
  { name: 'west', dx: -1, dz: 0 },
];

/** A part of a blueprint, as the failure message names it. */
export type Part =
  | 'roof'
  | 'north wall'
  | 'south wall'
  | 'east wall'
  | 'west wall'
  | 'floor'
  | 'centre column';
/** The order the parts are named in. */
const PART_ORDER: readonly Part[] = [
  'roof',
  'north wall',
  'south wall',
  'east wall',
  'west wall',
  'floor',
  'centre column',
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
  /** The cell numbers behind `unplaced`, in build order: the failure message names their parts. */
  refused: number[];
  /** The first refusal seen, as `reason: message`. */
  firstFailure: string | null;
}

/**
 * `build`: puts up a named blueprint (`shelter`, `wall`, `pillar`) of one block the body holds,
 * through `place`, lowest layer first. Arguments: `{ blueprint, block }`. Offsets are relative to
 * the cell the body stood in at the start. When the next cell is the body's own, it steps aside
 * first. A cell that already holds a solid block counts as done. A cell refused as `blocked` or
 * `timeout` is deferred: after the last cell one retry pass runs over the deferred cells, and the
 * intent fails only if some cell is still refused. The failure names the parts of the blueprint
 * the refused cells lie in. A completed build of a body that is not enclosed names the open sides.
 * Checkpoint: the blueprint, block, origin, `next`, the deferred and refused cells, the retry flag
 * and the counts; a cell in an old checkpoint before `next` counts as placed. Out of blocks wakes
 * the Mind (`precondition_failed`) and says how many are missing; any other refusal fails the
 * intent with the step number.
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
      refused: [],
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
      if (index === undefined || !cell) return this.finish(ctx, cells);
      if (retrying) state.retried = true;
      const at = {
        x: state.origin.x + cell.dx,
        y: state.origin.y + cell.dy,
        z: state.origin.z + cell.dz,
      };
      if (isSolid(ctx.bot.blockAt(new Vec3(at.x, at.y, at.z))) || doorTopDone(ctx, state, cell)) {
        state.solid++;
        settle(state, retrying);
        continue;
      }
      const aside = await this.stepAside(ctx, at, cells);
      if (aside) return aside;
      const doorway =
        state.blueprint === 'shelter' && cell.dx === 0 && cell.dy === 0 && cell.dz === 1;
      const block = doorway ? (heldWoodenDoor(ctx) ?? state.block) : state.block;
      const run = await runStepAction(ctx, { do: 'place', block, at });
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
          message: `${reason}: ${this.progress(cells.length)} Stopped at step ${index + 1}: ${reason}: ${message}`,
        };
      }
      state.firstFailure ??= `${reason}: ${message}`;
      if (!retrying) {
        state.deferred.push(index);
      } else {
        state.unplaced++;
        state.refused.push(index);
      }
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
          cells: blueprintCells(s.blueprint).length,
          next: s.next,
          deferred: [...s.deferred],
          retried: s.retried,
          placed: s.placed,
          solid: s.solid,
          unplaced: s.unplaced,
          refused: [...s.refused],
          firstFailure: s.firstFailure,
        }
      : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    // The fields added after the first checkpoint format are read by hand, so that an old
    // checkpoint without them still resumes; the reader sees only the fields it knows.
    const { deferred, refused, retried, firstFailure, cells, ...core } = saved;
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
    const cellCount = blueprintCells(blueprint).length;
    // A shelter checkpoint from before decision 0163 counts 23 cells, not 25, so its `next` does not
    // index the same cells. Such a build starts again from cell 0; the cells already built are solid.
    if (blueprint === 'shelter' && cells !== cellCount) {
      this.state = {
        blueprint,
        block,
        origin,
        next: 0,
        deferred: [],
        retried: false,
        placed: 0,
        solid: 0,
        unplaced: 0,
        refused: [],
        firstFailure: null,
      };
      return;
    }
    this.state = {
      blueprint,
      block,
      origin,
      next,
      deferred: readCellList(deferred, cellCount, 'deferred'),
      retried: retried === true,
      placed,
      solid,
      unplaced,
      refused: readCellList(refused, cellCount, 'refused'),
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

  /**
   * Done when every cell is placed or solid. Otherwise it names the parts the refused cells lie
   * in, for example `The roof and the north wall could not be placed; first failure: ...`.
   */
  private finish(ctx: ProgramContext, cells: readonly Cell[]): StepResult {
    const state = this.need();
    const progress = this.progress(cells.length);
    if (state.unplaced === 0) {
      const note = enclosureNote(ctx, state.origin);
      return { status: 'completed', detail: { message: `${progress}${note}` } };
    }
    const subject = refusedSubject(state.refused, cells);
    return {
      status: 'failed',
      message: `not_possible: ${progress} ${subject} could not be placed; first failure: ${state.firstFailure ?? 'unknown'}.`,
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
        message: `not_possible: ${this.progress(cells.length)} No room to step aside.`,
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

/** The wooden door items a shelter's doorway can take (decision 0163: iron doors are not wooden). */
const WOODEN_DOORS = [
  'oak_door',
  'spruce_door',
  'birch_door',
  'jungle_door',
  'acacia_door',
  'dark_oak_door',
  'mangrove_door',
  'cherry_door',
  'bamboo_door',
  'crimson_door',
  'warped_door',
] as const;

/** The first wooden door the body holds, for the shelter's doorway; null when it holds none. */
function heldWoodenDoor(ctx: ProgramContext): string | null {
  return WOODEN_DOORS.find((name) => ctx.view.inventoryCount(name) > 0) ?? null;
}

/**
 * True for the shelter's upper doorway cell once a door stands in the lower one: a placed door fills
 * both halves, so the upper half is never placed separately (decision 0163).
 */
function doorTopDone(
  ctx: ProgramContext,
  state: BuildState,
  cell: { dx: number; dy: number; dz: number },
): boolean {
  if (state.blueprint !== 'shelter' || cell.dx !== 0 || cell.dy !== 1 || cell.dz !== 1)
    return false;
  const lower = ctx.bot.blockAt(new Vec3(state.origin.x, state.origin.y, state.origin.z + 1));
  return lower?.name.endsWith('_door') === true;
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

/** A cell list from a checkpoint: absent is empty; anything else must be valid cell numbers. */
function readCellList(raw: unknown, cellCount: number, field: string): number[] {
  if (raw === undefined) return [];
  const valid =
    Array.isArray(raw) &&
    raw.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < cellCount);
  if (!valid) throw new ProgramError('invalid_args', 'build', `${field} must list cell numbers`);
  return raw as number[];
}

interface Extents {
  minX: number;
  maxX: number;
  minDy: number;
  maxDy: number;
  minZ: number;
  maxZ: number;
}

function extentsOf(cells: readonly Cell[]): Extents {
  const xs = cells.map((c) => c.dx);
  const ys = cells.map((c) => c.dy);
  const zs = cells.map((c) => c.dz);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minDy: Math.min(...ys),
    maxDy: Math.max(...ys),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/**
 * The walls a cell is on. A side is an outer edge of the blueprint that reaches past the origin:
 * the north edge is the least z when that is below the origin, and so on. A corner is on two walls.
 */
function wallsOf(cell: Cell, e: Extents): Part[] {
  const walls: Part[] = [];
  if (e.minZ < 0 && cell.dz === e.minZ) walls.push('north wall');
  if (e.maxZ > 0 && cell.dz === e.maxZ) walls.push('south wall');
  if (e.maxX > 0 && cell.dx === e.maxX) walls.push('east wall');
  if (e.minX < 0 && cell.dx === e.minX) walls.push('west wall');
  return walls;
}

/**
 * The parts of a blueprint a cell lies in, from the blueprint's extents and the origin. A cell in a
 * layer below the origin's is the floor. A blueprint more than one layer high has a roof when its
 * top layer has a cell off the outer edges: then the whole top layer is the roof, and a roof cell
 * is on no wall. Otherwise a cell on an outer edge is on the wall, and any other cell is in the
 * centre column.
 */
export function partsOf(cell: Cell, cells: readonly Cell[]): Part[] {
  if (cell.dy < 0) return ['floor'];
  const e = extentsOf(cells);
  const roof =
    e.maxDy > e.minDy && cells.some((c) => c.dy === e.maxDy && wallsOf(c, e).length === 0);
  if (roof && cell.dy === e.maxDy) return ['roof'];
  const walls = wallsOf(cell, e);
  return walls.length > 0 ? walls : ['centre column'];
}

/** The subject of the failure sentence: the parts of the refused cells, in `PART_ORDER`. */
function refusedSubject(refused: readonly number[], cells: readonly Cell[]): string {
  const found = new Set<Part>();
  for (const index of refused) {
    const cell = cells[index];
    if (cell) for (const part of partsOf(cell, cells)) found.add(part);
  }
  const names = PART_ORDER.filter((part) => found.has(part)).map((part) => `the ${part}`);
  if (names.length === 0) return 'Some cells';
  const words = joinWords(names);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Joins words as `a`, `a and b`, or `a, b and c`. */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The sentence added to a completed build when the view says the body is not enclosed: the sides
 * open at the feet or head. Empty when the view says the body is enclosed, or does not say.
 */
function enclosureNote(ctx: ProgramContext, origin: { x: number; y: number; z: number }): string {
  if (ctx.view.enclosed !== false) return '';
  const gaps = SIDES.flatMap((side) =>
    [0, 1].map((dy) => ({
      side,
      block: ctx.bot.blockAt(new Vec3(origin.x + side.dx, origin.y + dy, origin.z + side.dz)),
    })),
  ).filter((gap) => !isClosedCell(gap.block));
  if (gaps.length === 0) return ' Not enclosed.';
  if (gaps.every((gap) => gap.block?.name.endsWith('_door')))
    return ' Not enclosed: the door is open.';
  const open = SIDES.filter((side) => gaps.some((gap) => gap.side === side)).map(
    (side) => side.name,
  );
  return ` Not enclosed: open to the ${joinWords(open)}.`;
}
