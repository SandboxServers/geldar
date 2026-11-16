import { describe, expect, it, vi } from 'vitest';
import { planFor, waits } from './executor.fakes.ts';
import { runPlanAction } from './executor-action.ts';
import { MemorySink } from './records.ts';
import type { BodyRuntime } from './runtime.ts';

describe('the internal-fault line of a failed action', () => {
  it('is one JSON object with the action id, the life id, the reason and the exception', async () => {
    const sink = new MemorySink();
    const runtime = {
      sink,
      runAction: () => Promise.reject(new TypeError('boom in the runtime')),
    } as unknown as BodyRuntime;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const plan = planFor(1);
      const report = await runPlanAction(
        runtime,
        () => new Date(0),
        waits(1)[0] as never,
        'ac_fault_1',
        1,
        plan,
      );
      expect(report.record.result).toMatchObject({ status: 'failed', reason: 'internal' });
      expect(error).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(line).toMatchObject({
        action_id: 'ac_fault_1',
        life_id: plan.lifeId,
        reason: 'internal',
        'exception.type': 'TypeError',
        'exception.message': 'boom in the runtime',
      });
      expect(String(line['exception.stacktrace'])).toContain('boom in the runtime');
    } finally {
      error.mockRestore();
    }
  });

  it('scrubs a token out of the line and still logs a thrown non-Error', async () => {
    const runtime = {
      sink: new MemorySink(),
      runAction: () => Promise.reject(`plain string with gmcp-${'cd34'.repeat(16)}`),
    } as unknown as BodyRuntime;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await runPlanAction(
        runtime,
        () => new Date(0),
        waits(1)[0] as never,
        'ac_fault_2',
        1,
        planFor(1),
      );
      const line = String(error.mock.calls[0]?.[0]);
      expect(JSON.parse(line).action_id).toBe('ac_fault_2');
      expect(line).not.toContain('cd34cd34');
    } finally {
      error.mockRestore();
    }
  });
});
