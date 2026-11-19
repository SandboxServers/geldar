import type { Intent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ChunkHeading, loadedNeighbours } from '../../perception/observed-chunks.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, type PlainObject, ProgramError } from './args.ts';

const MAX_VISITED = 96;
const MAX_LEGS = 12;
const HEADINGS: readonly ChunkHeading[] = ['n', 'e', 's', 'w'];
const DANGER_RADIUS = 8;
const DANGER_HEALTH = 8;
/** How far above and below the Body's feet the landing scan looks for a solid block. */
const SCAN_UP = 8;
const SCAN_DEPTH = 32;
const CHECKPOINT_FIELDS = [
  'legs_done',
  'legs',
  'leg_blocks',
  'avoid_water',
  'chunks_new',
  'visited',
  'heading',
];

type Stop = 'legs' | 'no_frontier' | 'danger';

interface ExploreState {
  legs: number;
  legBlocks: number;
  avoidWater: boolean;
  legsDone: number;
  chunksNew: number;
  visited: Array<[number, number]>;
  heading: ChunkHeading | null;
}

/**
 * `explore`: walk outward through loaded terrain to chunks the run has not visited. Arguments:
 * `{ legs?, leg_blocks?, avoid_water? }` (defaults 6, 24 and true; legs 1 to 12, leg_blocks 8 to 48).
 * Each step takes one candidate: the loaded axis neighbours of the Body's chunk that are not in
 * `visited`, straight ahead first, then right, left and back (`null` heading counts as `n`). One
 * leg is one `goto` of `leg_blocks` along that axis. It stops completed with `legs`, `no_frontier`
 * or `danger` (a hostile within 8 blocks, or health under 8). The program never attacks.
 */
export class ExploreProgram implements IntentProgram {
  readonly name = 'explore';
  private state: ExploreState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('explore', args);
    const legs = reader.optionalInt('legs', 1, MAX_LEGS, 6);
    const legBlocks = reader.optionalInt('leg_blocks', 8, 48, 24);
    const avoidWater = 'avoid_water' in (args as PlainObject) ? reader.bool('avoid_water') : true;
    reader.done();
    this.state = {
      legs,
      legBlocks,
      avoidWater,
      legsDone: 0,
      chunksNew: 0,
      visited: [chunkOf(ctx.view.position)],
      heading: null,
    };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    if (ctx.view.nearbyHostiles(DANGER_RADIUS).length > 0 || ctx.view.health < DANGER_HEALTH) {
      return finished(state, 'danger');
    }
    if (state.legsDone >= state.legs) return finished(state, 'legs');
    const here = ctx.view.position;
    const [cx, cz] = chunkOf(here);
    const visited = new Set(state.visited.map(([x, z]) => keyOf(x, z)));
    const next = loadedNeighbours(ctx.bot, cx, cz)
      .filter((candidate) => !visited.has(keyOf(candidate.cx, candidate.cz)))
      .sort((a, b) => turnRank(state.heading, a.heading) - turnRank(state.heading, b.heading))[0];
    if (!next) return finished(state, 'no_frontier');
    const x = Math.floor(here.x) + (next.cx - cx) * state.legBlocks;
    const z = Math.floor(here.z) + (next.cz - cz) * state.legBlocks;
    const y = landingY(ctx.bot, x, z, here.y);
    const run = await runStepAction(ctx, { do: 'goto', target: { x, y, z } });
    const stop = stopOf(run, ctx);
    if (stop) return stop;
    state.legsDone += 1;
    state.heading = next.heading;
    this.visit(state, chunkOf(ctx.view.position));
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    const state = this.state;
    if (!state) return null;
    return {
      legs_done: state.legsDone,
      legs: state.legs,
      leg_blocks: state.legBlocks,
      avoid_water: state.avoidWater,
      chunks_new: state.chunksNew,
      visited: state.visited.map(([x, z]) => [x, z]),
      heading: state.heading,
    };
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    for (const field of Object.keys(saved)) {
      if (!CHECKPOINT_FIELDS.includes(field)) {
        throw new ProgramError('invalid_args', 'explore', `checkpoint field ${field} is unknown`);
      }
    }
    const reader = checkpointReader('explore', saved);
    const legsDone = reader.int('legs_done', 0, MAX_LEGS);
    const legs = reader.int('legs', 1, MAX_LEGS);
    const legBlocks = reader.int('leg_blocks', 8, 48);
    const avoidWater = reader.bool('avoid_water');
    const chunksNew = reader.int('chunks_new', 0, MAX_LEGS);
    this.state = {
      legs,
      legBlocks,
      avoidWater,
      legsDone,
      chunksNew,
      visited: visitedOf(saved.visited),
      heading: headingOf(saved.heading),
    };
  }

  /** Adds an arrival chunk once; the oldest chunk drops when the list is over its cap. */
  private visit(state: ExploreState, [x, z]: [number, number]): void {
    if (state.visited.some(([vx, vz]) => vx === x && vz === z)) return;
    state.visited.push([x, z]);
    state.chunksNew += 1;
    if (state.visited.length > MAX_VISITED) state.visited.shift();
  }

  private need(): ExploreState {
    if (!this.state) throw new Error('explore was not started');
    return this.state;
  }
}

function finished(state: ExploreState, stopped: Stop): StepResult {
  return {
    status: 'completed',
    detail: { legs: state.legsDone, chunks_new: state.chunksNew, stopped },
  };
}

function chunkOf(pos: { x: number; z: number }): [number, number] {
  return [Math.floor(pos.x / 16), Math.floor(pos.z / 16)];
}

function keyOf(x: number, z: number): string {
  return `${x},${z}`;
}

/** 0 straight ahead, 1 right, 2 left, 3 back, relative to the last heading (`null` is `n`). */
function turnRank(heading: ChunkHeading | null, candidate: ChunkHeading): number {
  const base = heading === null ? 0 : HEADINGS.indexOf(heading);
  const turn = (HEADINGS.indexOf(candidate) - base + HEADINGS.length) % HEADINGS.length;
  return [0, 1, 3, 2][turn] ?? 0;
}

/** The first solid block at or below the scan top, one block above it; the feet's floor when none. */
function landingY(bot: Bot, x: number, z: number, feetY: number): number {
  const top = Math.floor(feetY) + SCAN_UP;
  for (let y = top; y >= top - SCAN_DEPTH; y -= 1) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (block?.boundingBox === 'block') return y + 1;
  }
  return Math.floor(feetY);
}

function visitedOf(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value) || value.length > MAX_VISITED) {
    throw new ProgramError(
      'invalid_args',
      'explore',
      `visited holds at most ${MAX_VISITED} chunks`,
    );
  }
  return value.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger)) {
      throw new ProgramError('invalid_args', 'explore', 'visited holds integer [cx, cz] pairs');
    }
    return [pair[0], pair[1]];
  });
}

function headingOf(value: unknown): ChunkHeading | null {
  if (value === null) return null;
  if (typeof value === 'string' && (HEADINGS as readonly string[]).includes(value)) {
    return value as ChunkHeading;
  }
  throw new ProgramError('invalid_args', 'explore', 'heading is n, e, s, w or null');
}
