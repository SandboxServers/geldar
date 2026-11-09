import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader } from './args.ts';

interface FleeState {
  distance: number;
  maxLegs: number;
  legs: number;
}

/**
 * `flee`: run from nearby hostiles until none is within `distance`. Arguments:
 * `{ distance?, max_legs? }` (defaults 24 and 4, distance 8 to 64). Each step looks for hostiles
 * within `distance`; with none the run is done, otherwise it runs one `goto` to a point `distance`
 * blocks straight away from them. After `max_legs` legs it fails with `blocked`. Checkpoint:
 * `{ distance, maxLegs, legs }`.
 */
export class FleeProgram implements IntentProgram {
  readonly name = 'flee';
  private state: FleeState | null = null;

  async start(args: Intent['arguments'], _ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('flee', args);
    const distance = reader.optionalInt('distance', 8, 64, 24);
    const maxLegs = reader.optionalInt('max_legs', 1, 10, 4);
    reader.done();
    this.state = { distance, maxLegs, legs: 0 };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const hostiles = ctx.view.nearbyHostiles(state.distance);
    if (hostiles.length === 0) {
      return { status: 'completed', detail: { legs: state.legs } };
    }
    if (state.legs >= state.maxLegs) {
      return {
        status: 'failed',
        message: `blocked: ${hostiles.length} hostile(s) still near after ${state.legs} legs`,
      };
    }
    const here = ctx.view.position;
    // Sum of unit vectors pointing from each hostile to the Body, flat on the ground plane.
    let dx = 0;
    let dz = 0;
    for (const mob of hostiles) {
      const ox = here.x - mob.position.x;
      const oz = here.z - mob.position.z;
      const length = Math.hypot(ox, oz) || 1;
      dx += ox / length;
      dz += oz / length;
    }
    const length = Math.hypot(dx, dz);
    // Hostiles on all sides cancel out: pick +x so the run is still deterministic.
    const [ux, uz] = length < 1e-6 ? [1, 0] : [dx / length, dz / length];
    state.legs += 1;
    const run = await runStepAction(ctx, {
      do: 'goto',
      target: {
        x: Math.round(here.x + ux * state.distance),
        y: here.y,
        z: Math.round(here.z + uz * state.distance),
      },
    });
    const stop = stopOf(run, ctx);
    if (stop) {
      if (stop.status === 'running') state.legs -= 1;
      return stop;
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    return this.state ? { ...this.state } : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('flee', saved);
    const distance = reader.int('distance', 8, 64);
    const maxLegs = reader.int('maxLegs', 1, 10);
    const legs = reader.int('legs', 0, 10);
    reader.done();
    this.state = { distance, maxLegs, legs };
  }

  private need(): FleeState {
    if (!this.state) throw new Error('flee was not started');
    return this.state;
  }
}
