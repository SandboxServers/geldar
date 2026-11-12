import { validateActionOutcomePayload } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { cancelled } from '../actions/outcome.ts';
import { executorHarness, planFor, thought, waits } from './executor.fakes.ts';
import { runPlanAction } from './executor-action.ts';
import { MemorySink } from './records.ts';
import type { BodyRuntime } from './runtime.ts';

describe('a plan that arrives while another action runs', () => {
  it('reports busy, not internal, and leaves the running action alone', async () => {
    const h = executorHarness();
    h.handlers.wait.run = async (ctx) => {
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return cancelled();
    };
    const first = h.executor.submit(thought({ actions: waits(1) }), planFor(1, { n: 1 }));
    await vi.waitFor(() => expect(h.runtime.actionRunning).toBe(true));

    await h.executor.submit(thought({ actions: waits(1) }), planFor(1, { n: 2 }));

    const busy = h.sink.outcomes.at(-1);
    expect(busy).toMatchObject({ verb: 'wait', ok: false, reason: 'busy' });
    expect(busy?.message).toContain('another action is still running');
    expect(validateActionOutcomePayload(busy).ok).toBe(true);
    expect(h.runtime.actionRunning).toBe(true);

    await h.runtime.cancelAction();
    await first;
  });

  it('a runtime error that is not a busy slot stays internal and its message is logged', async () => {
    const sink = new MemorySink();
    const runtime = {
      sink,
      runAction: () => Promise.reject(new Error('boom in the runtime')),
    } as unknown as BodyRuntime;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = await runPlanAction(
        runtime,
        () => new Date(0),
        waits(1)[0] as never,
        'ac_internal',
        1,
        planFor(1),
      );
      expect(report.record.result).toMatchObject({ status: 'failed', reason: 'internal' });
      const logged = error.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('boom in the runtime');
    } finally {
      error.mockRestore();
    }
  });
});
