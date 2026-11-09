import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, type Position } from './args.ts';

/** How many goto legs `travel` tries before it gives up. */
const MAX_LEGS = 3;
/** How close (blocks) the feet must be to a position target for the trip to count as done. */
const ARRIVED = 1;

interface TravelState {
  target: Position | string;
  legs: number;
}

/**
 * `travel`: walk to a position, or up to a player. Arguments: `{ target: {x,y,z} | playerName }`.
 * Each step checks arrival, then runs one `goto`. Checkpoint: `{ target, legs }`. A position trip
 * is done when the feet are within one block of it; a player trip when the `goto` completes.
 */
export class TravelProgram implements IntentProgram {
  readonly name = 'travel';
  private state: TravelState | null = null;

  async start(args: Intent['arguments'], _ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('travel', args);
    const target = reader.positionOrPlayer('target');
    reader.done();
    this.state = { target, legs: 0 };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const { target } = state;
    if (typeof target !== 'string' && arrived(ctx.view.position, target)) {
      return {
        status: 'completed',
        detail: { position: { ...ctx.view.position }, legs: state.legs },
      };
    }
    if (state.legs >= MAX_LEGS) {
      return { status: 'failed', message: `blocked: not at the target after ${MAX_LEGS} legs` };
    }
    state.legs += 1;
    const run = await runStepAction(ctx, { do: 'goto', target });
    const stop = stopOf(run, ctx);
    if (stop) {
      if (stop.status === 'running') state.legs -= 1;
      return stop;
    }
    if (typeof target === 'string') return { status: 'completed', detail: { player: target } };
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    const state = this.state;
    if (!state) return null;
    return {
      target: typeof state.target === 'string' ? state.target : { ...state.target },
      legs: state.legs,
    };
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('travel', saved);
    const target = reader.positionOrPlayer('target');
    const legs = reader.int('legs', 0, MAX_LEGS);
    reader.done();
    this.state = { target, legs };
  }

  private need(): TravelState {
    if (!this.state) throw new Error('travel was not started');
    return this.state;
  }
}

function arrived(at: Position, target: Position): boolean {
  return (
    Math.abs(at.x - target.x) <= ARRIVED &&
    Math.abs(at.z - target.z) <= ARRIVED &&
    Math.abs(at.y - target.y) <= ARRIVED
  );
}
