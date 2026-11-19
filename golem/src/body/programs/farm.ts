import type { Intent } from '@geldar/contract';
import { Vec3 } from 'vec3';
import type { Block } from '../../actions/bot-types.ts';
import type { JsonValue } from '../../actions/outcome.ts';
import { SEED_CROPS } from '../../actions/place.ts';
import { prefetchOwners } from '../../actions/protected-blocks.ts';
import { CROP_MAX_AGE } from '../../perception/surroundings/food-known.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, ProgramError } from './args.ts';
import { ageOf, type CropState, cropStateAt, ownerOf, readField } from './farm-field.ts';

const MAX_CELLS_LIMIT = 32;
const CELL_STATES: readonly string[] = ['ripe', 'unripe', 'empty'];

/** A cell in the checkpoint: x, y, z and the state read when the field was read. */
type SavedCell = [number, number, number, CropState];

interface FarmState {
  replant: boolean;
  maxCells: number;
  cells: SavedCell[];
  next: number;
  harvested: number;
  sown: number;
  skippedOwned: number;
  skippedUnknown: number;
  /** The index whose owner was already checked, so a harvest is not re-gated on its next step. */
  gated: number | null;
  /** The crop name harvested from the current cell, so the sow after it takes a matching seed. Not checkpointed. */
  lastCrop: string | null;
}

/** Why the program stopped, as the detail's `stopped` value. */
type Stopped = 'done' | 'no_cells' | 'no_seeds' | 'limit';

/**
 * True when a harvest shows on a re-read: the crop is gone, or it is still there with its age
 * reset below the crop's maximum. A null read (unloaded) proves nothing.
 */
function harvestShown(after: Block | null, name: string): boolean {
  if (after === null) return false;
  if (after.name !== name) return true;
  return ageOf(after) < (CROP_MAX_AGE[name] ?? 0);
}

/**
 * The first seed item the Body carries whose crop is `crop` (a value in `SEED_CROPS`); when `crop`
 * is null (an empty cell, or after a resume) the first carried seed of any crop.
 */
function carriedSeed(ctx: ProgramContext, crop: string | null): string | null {
  for (const [seed, seedCrop] of SEED_CROPS) {
    if (crop !== null && seedCrop !== crop) continue;
    if (ctx.view.inventoryCount(seed) > 0) return seed;
  }
  return null;
}

/**
 * `farm`: harvest the ripe crops the Body can see within `radius`, and sow the empty farmland
 * when `replant` is set and a seed is carried. Arguments: `{ radius?, max_cells?, replant? }`
 * (radius 4 to 24, default 12; max_cells 1 to 32, default 16; replant default true). The program
 * never touches another player's crop or a cell of unknown ownership, and it never tills.
 * Each step handles one cell. A cell is read again when the step reaches it, so a resumed run
 * never repeats a harvest it already made.
 */
export class FarmProgram implements IntentProgram {
  readonly name = 'farm';
  private state: FarmState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('farm', args);
    const radius = reader.optionalInt('radius', 4, 24, 12);
    const maxCells = reader.optionalInt('max_cells', 1, MAX_CELLS_LIMIT, 16);
    const replant = Object.hasOwn(args, 'replant') ? reader.bool('replant') : true;
    reader.done();
    const cells = readField(ctx.bot, radius, maxCells, replant);
    await prefetchOwners(
      cells.map((c) => new Vec3(c.x, c.y, c.z)),
      ctx.signal,
    );
    this.state = {
      replant,
      maxCells,
      cells: cells.map((c): SavedCell => [c.x, c.y, c.z, c.state]),
      next: 0,
      harvested: 0,
      sown: 0,
      skippedOwned: 0,
      skippedUnknown: 0,
      gated: null,
      lastCrop: null,
    };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const s = this.need();
    if (s.cells.length === 0) return this.finish(s, 'no_cells');
    if (s.next >= s.cells.length) {
      return this.finish(s, s.cells.length >= s.maxCells ? 'limit' : 'done');
    }
    const [x, y, z] = s.cells[s.next] as SavedCell;
    const pos = new Vec3(x, y, z);
    const seen = cropStateAt(ctx.bot, pos, s.replant);
    if (s.gated !== s.next) {
      const owner = ownerOf(ctx.bot, { x, y, z }, seen?.state);
      if (owner === 'other') return this.skip(s, 'owned');
      if (owner === 'unknown') return this.skip(s, 'unknown');
      s.gated = s.next;
    }
    if (!seen || seen.state === 'unripe') return this.advance(s);
    if (seen.state === 'ripe') return this.harvest(ctx, s, pos, seen.name);
    return this.sow(ctx, s, pos);
  }

  private async harvest(
    ctx: ProgramContext,
    s: FarmState,
    pos: Vec3,
    name: string,
  ): Promise<StepResult> {
    const run = await runStepAction(
      ctx,
      { do: 'mine', block: name, count: 1 },
      { mineAt: { x: pos.x, y: pos.y, z: pos.z } },
    );
    const stop = stopOf(run, ctx);
    if (stop) return stop;
    if (!harvestShown(ctx.bot.blockAt(pos), name)) return this.advance(s);
    s.harvested += 1;
    s.lastCrop = name;
    return s.replant ? { status: 'running' } : this.advance(s);
  }

  private async sow(ctx: ProgramContext, s: FarmState, pos: Vec3): Promise<StepResult> {
    if (!s.replant) return this.advance(s);
    const seed = carriedSeed(ctx, s.lastCrop);
    if (seed === null) return this.finish(s, 'no_seeds');
    const run = await runStepAction(ctx, {
      do: 'place',
      block: seed,
      at: { x: pos.x, y: pos.y, z: pos.z },
    });
    const stop = stopOf(run, ctx);
    if (stop) return stop;
    s.sown += 1;
    return this.advance(s);
  }

  private skip(s: FarmState, kind: 'owned' | 'unknown'): StepResult {
    if (kind === 'owned') s.skippedOwned += 1;
    else s.skippedUnknown += 1;
    return this.advance(s);
  }

  private advance(s: FarmState): StepResult {
    s.next += 1;
    s.lastCrop = null;
    return { status: 'running' };
  }

  private finish(s: FarmState, stopped: Stopped): StepResult {
    const detail: Record<string, JsonValue> = {
      harvested: s.harvested,
      sown: s.sown,
      skipped_owned: s.skippedOwned,
      skipped_unknown: s.skippedUnknown,
      stopped,
    };
    return { status: 'completed', detail };
  }

  checkpoint(): ProgramCheckpoint | null {
    if (!this.state) return null;
    const s = this.state;
    return {
      replant: s.replant,
      max_cells: s.maxCells,
      cells: s.cells.map((cell) => [...cell]),
      next: s.next,
      harvested: s.harvested,
      sown: s.sown,
      skipped: s.skippedOwned + s.skippedUnknown,
      skipped_owned: s.skippedOwned,
      skipped_unknown: s.skippedUnknown,
    };
  }

  async resume(saved: ProgramCheckpoint, ctx: ProgramContext): Promise<void> {
    const { cells: rawCells, ...scalars } = saved;
    const reader = checkpointReader('farm', scalars);
    const replant = reader.bool('replant');
    const maxCells = reader.int('max_cells', 1, MAX_CELLS_LIMIT);
    const next = reader.int('next', 0, MAX_CELLS_LIMIT);
    const harvested = reader.int('harvested', 0, 1_000_000);
    const sown = reader.int('sown', 0, 1_000_000);
    const skippedOwned = reader.int('skipped_owned', 0, 1_000_000);
    const skippedUnknown = reader.int('skipped_unknown', 0, 1_000_000);
    reader.int('skipped', 0, 2_000_000);
    const cells = parseCells(rawCells);
    reader.done();
    if (next > cells.length)
      throw new ProgramError('invalid_args', 'farm', 'next is past the cells');
    await prefetchOwners(
      cells.map((c) => new Vec3(c[0], c[1], c[2])),
      ctx.signal,
    );
    this.state = {
      replant,
      maxCells,
      cells,
      next,
      harvested,
      sown,
      skippedOwned,
      skippedUnknown,
      gated: null,
      lastCrop: null,
    };
  }

  private need(): FarmState {
    if (!this.state) throw new Error('farm was not started');
    return this.state;
  }
}

/** The saved cells, checked: at most 32 entries of [x, y, z, state] with integer coordinates. */
function parseCells(raw: unknown): SavedCell[] {
  if (!Array.isArray(raw) || raw.length > MAX_CELLS_LIMIT) {
    throw new ProgramError('invalid_args', 'farm', 'cells must be a list of at most 32 cells');
  }
  return raw.map((cell: unknown): SavedCell => {
    if (!Array.isArray(cell) || cell.length !== 4) {
      throw new ProgramError('invalid_args', 'farm', 'a cell is [x, y, z, state]');
    }
    const [x, y, z, state] = cell as unknown[];
    const ints = [x, y, z].every((v) => Number.isInteger(v));
    if (!ints || typeof state !== 'string' || !CELL_STATES.includes(state)) {
      throw new ProgramError('invalid_args', 'farm', 'a cell has integers and a state');
    }
    return [x as number, y as number, z as number, state as CropState];
  });
}
