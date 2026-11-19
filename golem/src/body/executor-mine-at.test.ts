import { describe, expect, it } from 'vitest';
import type { Position } from '../actions/bot-types.ts';
import { completed } from '../actions/outcome.ts';
import type { ActionContext } from '../actions/registry.ts';
import { executorHarness, planFor, thought } from './executor.fakes.ts';
import type { IntentProgram, ProgramContext, StepResult } from './program.ts';
import { runStepAction } from './programs/action-step.ts';

const CELL = { x: 1, y: 64, z: 0 };

describe('executor: a program step names an exact cell', () => {
  it("a program's exact cell reaches the mine handler, and an action without one carries none", async () => {
    const h = executorHarness();
    const seen: (Position | undefined)[] = [];
    h.runtime.actions.register({
      kind: 'mine',
      timeoutMs: 1000,
      run: async (ctx: ActionContext) => {
        seen.push(ctx.mineAt);
        return completed({ mined: 1 });
      },
    });
    const program: IntentProgram = {
      name: 'fake',
      start: async () => undefined,
      resume: async () => undefined,
      checkpoint: () => null,
      step: async (ctx: ProgramContext): Promise<StepResult> => {
        await runStepAction(ctx, { do: 'mine', block: 'stone', count: 1 }, { mineAt: CELL });
        await runStepAction(ctx, { do: 'mine', block: 'stone', count: 1 });
        return { status: 'completed' };
      },
    };
    h.program.current = program;
    await h.executor.submit(
      thought({ intent: { program: 'fake', wake_on: ['goal_completed'] } }),
      planFor(0),
    );
    await h.executor.onTick(1);
    expect(seen).toEqual([{ x: 1, y: 64, z: 0 }, undefined]);
  });
});
