import type { Action } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  executorHarness,
  fakeId,
  planFor,
  type scriptedProgram,
  thought,
} from './executor.fakes.ts';
import { markBlockedAbandoned } from './reflexes/blocked-path.ts';

describe('an intent the blocked-path reflex gave up on', () => {
  it('fails blocked with a wake to the Mind on its next step', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBe('running');
    markBlockedAbandoned(h.runtime.view, fakeId('in', 1));
    await h.executor.onTick(2);
    expect(h.executor.intentState).toBeNull();
    const last = h.sink.intents.at(-1);
    expect(last?.state).toBe('failed');
    expect(last?.detail).toContain('blocked');
    expect(h.sink.wakes.map((w) => w.reason)).toEqual(['action_failed']);
  });

  it('carries the flag in the program checkpoint', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.executor.checkpoint()).toEqual({ steps: 1 });
    markBlockedAbandoned(h.runtime.view, fakeId('in', 1));
    expect(h.executor.checkpoint()).toEqual({ steps: 1, blocked_abandoned: true });
  });

  it('fails a resumed intent whose checkpoint carries the flag, and hands the program its own part', async () => {
    const h = executorHarness();
    const t = thought({ intent: {} }) as { intent: Record<string, unknown> };
    t.intent.checkpoint = { steps: 4, blocked_abandoned: true };
    await h.executor.resume(
      t.intent as unknown as Parameters<typeof h.executor.resume>[0],
      fakeId('in', 1),
    );
    const log = (h.program.current as ReturnType<typeof scriptedProgram>).log;
    expect(log.resumed).toEqual([{ steps: 4 }]);
    await h.executor.onTick(1);
    expect(h.executor.intentState).toBeNull();
    expect(h.sink.intents.at(-1)?.state).toBe('failed');
    expect(log.steps).toBe(0);
  });

  it('keeps walking an intent the reflex did not give up on', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    markBlockedAbandoned(h.runtime.view, fakeId('in', 99));
    await h.executor.onTick(2);
    expect(h.executor.intentState).toBe('running');
  });
});

describe('ranByProgram', () => {
  it('is true for an action the program ran, false for a plan action', async () => {
    const h = executorHarness();
    const own: Action = { do: 'wait', seconds: 1 };
    h.program.current = {
      name: 'fake',
      start: async () => undefined,
      resume: async () => undefined,
      checkpoint: () => null,
      step: async (ctx) => {
        await ctx.runAction(own, ctx.signal);
        return { status: 'running' };
      },
    };
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    await h.executor.onTick(1);
    expect(h.executor.ranByProgram(own)).toBe(true);
    expect(h.executor.ranByProgram({ do: 'wait', seconds: 1 })).toBe(false);
  });
});
