import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, type Position, ProgramError } from './args.ts';

/** A route holds this many points at least and at most. */
const MIN_POINTS = 2;
const MAX_POINTS = 8;
/** The most laps a looping route may run. */
const MAX_LAPS = 20;
/** A point counts as reached when the Body is this close to it (horizontal distance). */
const ARRIVAL_BLOCKS = 2;
/** A hostile within this many blocks ends the patrol, when the Body is also below this health. */
const DANGER_RADIUS = 8;
const DANGER_HEALTH = 8;
const ARGUMENT_FIELDS = ['route', 'loop', 'laps'];

interface PatrolState {
  route: Position[];
  loop: boolean;
  laps: number;
  /** Index of the point the Body walks to next. */
  leg: number;
  lapsDone: number;
}

/** Reads a route: an array of 2 to 8 positions with integer coordinates. */
function readRoute(value: unknown, what: string): Position[] {
  if (!Array.isArray(value) || value.length < MIN_POINTS || value.length > MAX_POINTS) {
    throw new ProgramError(
      'invalid_args',
      'patrol',
      `${what} route must be an array of ${MIN_POINTS} to ${MAX_POINTS} points`,
    );
  }
  return value.map((point) => new ArgReader('patrol', { point }, what).position('point'));
}

/**
 * `patrol`: walk a supplied route, point by point. Arguments: `{ route, loop?, laps? }`. `route`
 * is 2 to 8 positions `{ x, y, z }` of integers; the caller supplies them, the Body never looks a
 * position up. `loop` (default false) wraps from the last point to the first. With `loop`,
 * `laps` (1 to 20, default 1) is how many full rounds to run; without `loop` the route is walked
 * once and `laps` must be 1. Each step walks one `goto` to the next point; within 2 blocks of it
 * the leg advances. The program completes with `{ laps, stopped: 'laps' }` when the laps are done.
 * It completes with `{ laps, stopped: 'danger' }` when a hostile is within 8 blocks and the Body's
 * health is under 8. It never attacks. A blocked leg fails the intent through `stopOf`. Checkpoint:
 * the route, the flags, the current leg and the laps done.
 */
export class PatrolProgram implements IntentProgram {
  readonly name = 'patrol';
  private state: PatrolState | null = null;

  async start(args: Intent['arguments'], _ctx: ProgramContext): Promise<void> {
    new ArgReader('patrol', args);
    const source = args as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      if (!ARGUMENT_FIELDS.includes(key)) {
        throw new ProgramError('invalid_args', 'patrol', `arguments ${key} is not a known field`);
      }
    }
    const route = readRoute(source.route, 'arguments');
    const loop = source.loop === undefined ? false : source.loop;
    if (typeof loop !== 'boolean') {
      throw new ProgramError('invalid_args', 'patrol', 'arguments loop must be true or false');
    }
    const laps = source.laps === undefined ? 1 : source.laps;
    if (typeof laps !== 'number' || !Number.isInteger(laps) || laps < 1 || laps > MAX_LAPS) {
      throw new ProgramError(
        'invalid_args',
        'patrol',
        `arguments laps must be an integer from 1 to ${MAX_LAPS}`,
      );
    }
    if (!loop && laps !== 1) {
      throw new ProgramError('invalid_args', 'patrol', 'arguments laps must be 1 without loop');
    }
    this.state = { route, loop, laps, leg: 0, lapsDone: 0 };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    if (ctx.view.health < DANGER_HEALTH && ctx.view.nearbyHostiles(DANGER_RADIUS).length > 0) {
      return { status: 'completed', detail: { laps: state.lapsDone, stopped: 'danger' } };
    }
    const point = state.route[state.leg] as Position;
    const here = ctx.view.position;
    if (Math.hypot(point.x - here.x, point.z - here.z) <= ARRIVAL_BLOCKS) {
      return this.arrive(state);
    }
    const run = await runStepAction(ctx, {
      do: 'goto',
      target: { x: point.x, y: point.y, z: point.z },
    });
    return stopOf(run) ?? { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    const state = this.state;
    if (!state) return null;
    return {
      route: state.route.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      loop: state.loop,
      laps: state.laps,
      leg: state.leg,
      lapsDone: state.lapsDone,
    };
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const { route: savedRoute, ...rest } = saved;
    const reader = checkpointReader('patrol', rest);
    const laps = reader.int('laps', 1, MAX_LAPS);
    const lapsDone = reader.int('lapsDone', 0, MAX_LAPS);
    const leg = reader.int('leg', 0, MAX_POINTS - 1);
    const loop = reader.bool('loop');
    reader.done();
    const route = readRoute(savedRoute, 'checkpoint');
    if (leg >= route.length) {
      throw new ProgramError('invalid_args', 'patrol', 'checkpoint leg is past the route');
    }
    this.state = { route, loop, laps, leg, lapsDone };
  }

  /** The Body reached the current point: move to the next, or end a lap. */
  private arrive(state: PatrolState): StepResult {
    state.leg += 1;
    if (state.leg < state.route.length) return { status: 'running' };
    state.lapsDone += 1;
    if (!state.loop || state.lapsDone >= state.laps) {
      return { status: 'completed', detail: { laps: state.lapsDone, stopped: 'laps' } };
    }
    state.leg = 0;
    return { status: 'running' };
  }

  private need(): PatrolState {
    if (!this.state) throw new Error('patrol was not started');
    return this.state;
  }
}
