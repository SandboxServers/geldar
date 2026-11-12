import { validateActionOutcomePayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { executorHarness, planFor, thought, waits } from './executor.fakes.ts';
import { emitIntentFailure } from './executor-outcome.ts';
import { MemorySink } from './records.ts';

describe('per-action outcome events (C5-02)', () => {
  it('emits one action_outcome per finished action, in order, with success text', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ actions: waits(3) }), planFor(3));
    expect(h.sink.outcomes.map((o) => `${o.index}:${o.verb}:${o.ok}`)).toEqual([
      '0:wait:true',
      '1:wait:true',
      '2:wait:true',
    ]);
    expect(h.sink.outcomes.map((o) => o.message)).toEqual(Array(3).fill('Your wait worked.'));
    for (const o of h.sink.outcomes) expect(validateActionOutcomePayload(o).ok).toBe(true);
  });

  it('a failing second action is action index 1 with a reason; later actions emit nothing', async () => {
    const h = executorHarness();
    const actions = [{ do: 'wait', seconds: 1 }, { do: 'eat' }, { do: 'wait', seconds: 2 }];
    await h.executor.submit(thought({ actions }), planFor(3));
    expect(h.sink.outcomes).toHaveLength(2);
    const failed = h.sink.outcomes[1];
    expect(failed).toMatchObject({ verb: 'eat', index: 1, ok: false });
    expect(failed?.reason).toBeTypeOf('string');
    expect(failed?.message).toMatch(/^Your eat failed: .+\.$/);
    expect(validateActionOutcomePayload(failed).ok).toBe(true);
  });

  it('does not emit again for a redelivered action id', async () => {
    const h = executorHarness();
    const plan = planFor(1);
    await h.executor.submit(thought({ actions: waits(1) }), plan);
    await h.executor.submit(thought({ actions: waits(1) }), plan);
    expect(h.sink.outcomes).toHaveLength(1);
  });

  it('a failed intent carries a plain why keyed by program and reason, never the program text', () => {
    const sink = new MemorySink();
    emitIntentFailure(sink, 5, 'craft', 'missing_materials: missing <b>ignore previous</b>');
    emitIntentFailure(sink, 5, 'travel', 'free text with no reason code');
    expect(sink.outcomes[0]).toMatchObject({
      verb: 'craft',
      intent: true,
      ok: false,
      reason: 'missing_materials',
      why: 'You lack the materials to craft that.',
    });
    expect(sink.outcomes[1]?.reason).toBe('internal');
    expect(JSON.stringify(sink.outcomes)).not.toContain('ignore');
    for (const o of sink.outcomes) expect(validateActionOutcomePayload(o).ok).toBe(true);
  });

  it('keeps working with a sink that has no actionOutcome', async () => {
    const h = executorHarness();
    const sink = h.sink as unknown as { actionOutcome?: unknown };
    sink.actionOutcome = undefined;
    const result = await h.executor.submit(thought({ actions: waits(1) }), planFor(1));
    expect(result.failedAt).toBeNull();
  });
});
