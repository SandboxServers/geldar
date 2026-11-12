import type { Intent } from '@geldar/contract';
import { NOT_IN_SIGHT } from '../../actions/give.ts';
import { findVisibleAgent } from '../../perception/visible-agent.ts';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader, ProgramError } from './args.ts';

/** The Body stays within this many blocks of the target and walks when it is further. */
const CLOSE_ENOUGH = 3;

interface FollowState {
  target: string;
  maxUnseenSeconds: number;
  /** Whole seconds the target has been out of sight in a row. */
  unseen: number;
}

/**
 * `follow`: stay near a named agent. Arguments: `{ target, max_unseen_seconds? }` (the name; 1 to
 * 120 seconds, default 10). The target is resolved only among the players in sight now
 * (`findVisibleAgent`); a name that is not in sight is refused at `start` with the same text
 * whether or not the player exists. Each step walks toward the target when it is further than
 * `CLOSE_ENOUGH`, or waits one second when it is near. A step with the target out of sight waits
 * one second and counts it; after `max_unseen_seconds` in a row the intent fails with
 * `not_found: target out of sight for N seconds`. The program never completes on its own: the
 * intent's limits (world ticks, block operations) end it. Checkpoint: the whole state.
 */
export class FollowProgram implements IntentProgram {
  readonly name = 'follow';
  private state: FollowState | null = null;

  async start(args: Intent['arguments'], ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('follow', args);
    const target = reader.playerName('target');
    const maxUnseenSeconds = reader.optionalInt('max_unseen_seconds', 1, 120, 10);
    reader.done();
    if (!findVisibleAgent(ctx.bot, target))
      throw new ProgramError('invalid_args', 'follow', NOT_IN_SIGHT);
    this.state = { target, maxUnseenSeconds, unseen: 0 };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const seen = findVisibleAgent(ctx.bot, state.target);
    if (!seen) {
      if (state.unseen >= state.maxUnseenSeconds) {
        return {
          status: 'failed',
          message: `not_found: target out of sight for ${state.maxUnseenSeconds} seconds`,
        };
      }
      state.unseen += 1;
      return this.wait(ctx);
    }
    state.unseen = 0;
    if (seen.distance <= CLOSE_ENOUGH) return this.wait(ctx);
    const { x, y, z } = seen.position;
    const run = await runStepAction(ctx, {
      do: 'goto',
      target: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
    });
    return stopOf(run, ctx) ?? { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    return this.state ? { ...this.state } : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('follow', saved);
    const state = {
      target: reader.playerName('target'),
      maxUnseenSeconds: reader.int('maxUnseenSeconds', 1, 120),
      unseen: reader.int('unseen', 0, 120),
    };
    reader.done();
    this.state = state;
  }

  private async wait(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const run = await runStepAction(ctx, { do: 'wait', seconds: 1 });
    const stop = stopOf(run);
    if (stop) {
      // A cancelled wait did not pass the second.
      if (stop.status === 'running' && state.unseen > 0) state.unseen -= 1;
      return stop;
    }
    return { status: 'running' };
  }

  private need(): FollowState {
    if (!this.state) throw new Error('follow was not started');
    return this.state;
  }
}
