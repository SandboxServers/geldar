import type { Intent } from '@geldar/contract';
import type { IntentProgram, ProgramCheckpoint, ProgramContext, StepResult } from '../program.ts';
import { runStepAction, stopOf } from './action-step.ts';
import { ArgReader, checkpointReader } from './args.ts';

interface RestState {
  untilHealth: number;
  waitSeconds: number;
  maxWaits: number;
  /** True until the one sleep attempt has been made. */
  trySleep: boolean;
  slept: boolean;
  waits: number;
}

/**
 * `rest`: recover health. Arguments: `{ until_health?, wait_seconds?, max_waits? }` (defaults 20,
 * 5, 30). The first step tries to `sleep` in a nearby bed (it works only at night or in a storm);
 * if that fails the program falls back to `wait` steps of `wait_seconds` until health reaches
 * `until_health`, and fails with `timeout` after `max_waits` waits. Checkpoint: the whole state.
 */
export class RestProgram implements IntentProgram {
  readonly name = 'rest';
  private state: RestState | null = null;

  async start(args: Intent['arguments'], _ctx: ProgramContext): Promise<void> {
    const reader = new ArgReader('rest', args);
    const untilHealth = reader.optionalInt('until_health', 1, 20, 20);
    const waitSeconds = reader.optionalInt('wait_seconds', 1, 60, 5);
    const maxWaits = reader.optionalInt('max_waits', 1, 120, 30);
    reader.done();
    this.state = { untilHealth, waitSeconds, maxWaits, trySleep: true, slept: false, waits: 0 };
  }

  async step(ctx: ProgramContext): Promise<StepResult> {
    const state = this.need();
    const { health } = ctx.view;
    if (health >= state.untilHealth) {
      return {
        status: 'completed',
        detail: { health, slept: state.slept, waits: state.waits },
      };
    }
    if (state.trySleep) {
      state.trySleep = false;
      const run = await runStepAction(ctx, { do: 'sleep' });
      if (run.state === 'cancelled') {
        state.trySleep = true;
        return { status: 'running' };
      }
      // A failed sleep (no bed, daytime) is not an error: the next steps wait instead.
      state.slept = run.state === 'completed';
      return { status: 'running' };
    }
    if (state.waits >= state.maxWaits) {
      return { status: 'failed', message: `timeout: health ${health} below ${state.untilHealth}` };
    }
    state.waits += 1;
    const run = await runStepAction(ctx, { do: 'wait', seconds: state.waitSeconds });
    const stop = stopOf(run);
    if (stop) {
      if (stop.status === 'running') state.waits -= 1;
      return stop;
    }
    return { status: 'running' };
  }

  checkpoint(): ProgramCheckpoint | null {
    return this.state ? { ...this.state } : null;
  }

  async resume(saved: ProgramCheckpoint, _ctx: ProgramContext): Promise<void> {
    const reader = checkpointReader('rest', saved);
    const state = {
      untilHealth: reader.int('untilHealth', 1, 20),
      waitSeconds: reader.int('waitSeconds', 1, 60),
      maxWaits: reader.int('maxWaits', 1, 120),
      trySleep: reader.bool('trySleep'),
      slept: reader.bool('slept'),
      waits: reader.int('waits', 0, 120),
    };
    reader.done();
    this.state = state;
  }

  private need(): RestState {
    if (!this.state) throw new Error('rest was not started');
    return this.state;
  }
}
