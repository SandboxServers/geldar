import { describe, expect, it } from 'vitest';
import { executorHarness, planFor, scriptedProgram, thought } from './executor.fakes.ts';

describe('a death during an intent start (decision 0191)', () => {
  it('does not install the intent of a plan made before the Body died', async () => {
    const h = executorHarness();
    // The Body is in its first life with an intent running; the next plan's start is what the death lands in.
    await h.executor.submit(thought({ intent: { program: 'fake' } }), planFor(0, { n: 1 }));
    const program = scriptedProgram([{ status: 'running' }]);
    const started = program.start;
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    // The start waits here: the death happens while the new intent is between its checks and its install.
    program.start = async (args, ctx) => {
      await gate;
      await started(args, ctx);
    };
    h.program.current = program;

    const pending = h.executor.submit(
      thought({ intent: { program: 'fake' } }),
      planFor(0, { n: 2 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.executor.endForDeath(5);
    open();
    const result = await pending;

    expect(result.intent).toBe('skipped');
    expect(h.executor.runningIntent).toBeNull();
  });

  it('still installs an intent when no death came during its start', async () => {
    const h = executorHarness();
    const result = await h.executor.submit(
      thought({ intent: { program: 'fake' } }),
      planFor(0, { n: 3 }),
    );
    expect(result.intent).toBe('started');
    expect(h.executor.runningIntent).not.toBeNull();
  });
});
