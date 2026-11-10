import { describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../fakes/memory.fakes.ts';
import { makeDecision, makeRig, OPTIONS, VALID_THOUGHT } from './loop-fixtures.ts';

type Line = Record<string, unknown>;

/** A promise that never settles: the hung dependency. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Hangs the first call and answers the later ones with `next`. */
function hangFirst<A extends unknown[], R>(next: (...args: A) => Promise<R>) {
  let calls = 0;
  return (...args: A): Promise<R> => {
    calls++;
    return calls === 1 ? never<R>() : next(...args);
  };
}

/** The `reason` of every `cycle_aborted` line, in order. */
function aborts(logs: Line[]): unknown[] {
  return logs.filter((line) => line.event === 'cycle_aborted').map((line) => line.reason);
}

const STEP_MS = 50;

describe('ThinkingLoop: a hung step ends the cycle and the next wake thinks', () => {
  it('ends a cycle whose snapshot never comes', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS },
      deps: { log: (line) => logs.push(line) },
    });
    rig.body.requestSnapshot = hangFirst(rig.body.requestSnapshot.bind(rig.body));

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('model_error');
    expect(aborts(logs)).toEqual(['snapshot']);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
    expect(rig.attention.settled).toEqual(['model_error', 'planned']);
  });

  it('ends a cycle whose memory retrieval never returns', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS },
      deps: {
        log: (line) => logs.push(line),
        embedder: Object.assign(new FakeEmbedder(), {
          embed: hangFirst(async () => [[0]]),
        }),
      },
    });

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('model_error');
    expect(aborts(logs)).toEqual(['memory']);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
  });

  it('ends a cycle whose journal read never returns', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS },
      deps: { log: (line) => logs.push(line) },
    });
    rig.store.journalSince = hangFirst(rig.store.journalSince.bind(rig.store));

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('model_error');
    expect(aborts(logs)).toEqual(['journal']);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
  });

  it('ends a cycle whose thought row write never returns, before any plan is sent', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }, { text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS },
      deps: { log: (line) => logs.push(line) },
    });
    rig.store.recordThought = hangFirst(rig.store.recordThought.bind(rig.store));

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('model_error');
    expect(aborts(logs)).toEqual(['journal']);
    expect(rig.body.plans).toHaveLength(0);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
  });

  it('ends a cycle whose Thinker never answers, at the job deadline plus the step limit', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS, thought: { ...OPTIONS.thought, deadlineS: 1 } },
      deps: { log: (line) => logs.push(line) },
    });
    rig.model.complete = hangFirst(rig.model.complete.bind(rig.model));

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('model_error');
    expect(aborts(logs)).toEqual(['thinker']);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
  });

  it('keeps a committed plan when its event publish never returns', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }, { text: VALID_THOUGHT }], {
      loop: { stepTimeoutMs: STEP_MS },
      deps: { log: (line) => logs.push(line) },
    });
    rig.events.publish = hangFirst(rig.events.publish.bind(rig.events));

    const first = await rig.loop.handle(makeDecision('idle'));
    expect(first.outcome).toBe('planned');
    expect(aborts(logs)).toEqual(['publish']);

    const second = await rig.loop.handle(makeDecision('idle'));
    expect(second.outcome).toBe('planned');
    expect(rig.body.plans).toHaveLength(2);
  });

  it('logs each step of a cycle with elapsed ms and no model text', async () => {
    const logs: Line[] = [];
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      deps: { log: (line) => logs.push(line) },
    });

    await rig.loop.handle(makeDecision('idle'));
    const steps = logs.filter((line) =>
      [
        'thought_started',
        'snapshot_ok',
        'thinker_request_sent',
        'thinker_reply',
        'thought_committed',
      ].includes(String(line.event)),
    );
    expect(steps.map((line) => line.event)).toEqual([
      'thought_started',
      'snapshot_ok',
      'thinker_request_sent',
      'thinker_reply',
      'thought_committed',
    ]);
    for (const line of steps.slice(1)) expect(typeof line.elapsed_ms).toBe('number');
    expect(JSON.stringify(steps)).not.toContain(VALID_THOUGHT.slice(0, 24));
  });
});
