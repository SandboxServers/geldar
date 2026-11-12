import { describe, expect, it } from 'vitest';
import { MemorySink } from './records.ts';
import { type Reflex, type ReflexContext, ReflexRunner } from './reflex.ts';
import { allReflexesOn } from './reflex-config.ts';
import type { BodyView } from './view.ts';

/** A reflex whose check always fires and whose run is the given function. */
function reflexWith(run: Reflex['run'], check: Reflex['check'] = () => ({ hunger: 4 })): Reflex {
  return { name: 'eat', priority: 1, cooldownTicks: 100, check, run };
}

function runnerFor(reflex: Reflex, sink: MemorySink): ReflexRunner {
  return new ReflexRunner({
    reflexes: [reflex],
    config: allReflexesOn(),
    view: {} as BodyView,
    sink,
    lifeId: 'life-7',
    bodyGeneration: 3,
    context: () => ({}) as ReflexContext,
  });
}

describe('ReflexRunner records every firing', () => {
  it('writes one record with the name, life, body generation, tick, trigger and outcome', async () => {
    const sink = new MemorySink();
    const runner = runnerFor(
      reflexWith(async () => ({ result: 'handled', detail: 'ate bread' })),
      sink,
    );

    await runner.onTick(42);

    expect(sink.reflexes).toEqual([
      {
        name: 'eat',
        lifeId: 'life-7',
        bodyGeneration: 3,
        tick: 42,
        trigger: { hunger: 4 },
        outcome: { result: 'handled', detail: 'ate bread' },
      },
    ]);
  });

  it('records a run that throws as a failed outcome and still ends the firing', async () => {
    const sink = new MemorySink();
    const runner = runnerFor(
      reflexWith(async () => {
        throw new Error('no food in reach');
      }),
      sink,
    );

    await runner.onTick(10);

    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]?.outcome.result).toBe('failed');
    expect(sink.reflexes[0]?.outcome.detail).toContain('no food in reach');
    expect(runner.busy).toBe(false);
  });

  it('records a check that throws as one failed firing, not once per tick', async () => {
    const sink = new MemorySink();
    const runner = runnerFor(
      reflexWith(
        async () => ({ result: 'handled' }),
        () => {
          throw new Error('view is empty');
        },
      ),
      sink,
    );

    await runner.onTick(10);
    await runner.onTick(11);

    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]).toMatchObject({
      name: 'eat',
      tick: 10,
      trigger: {},
      outcome: { result: 'failed' },
    });
    expect(sink.reflexes[0]?.outcome.detail).toContain('view is empty');
  });

  it('keeps the record of a throwing run when the reflex is off cooldown later', async () => {
    const sink = new MemorySink();
    const runner = runnerFor(
      reflexWith(async () => {
        throw new Error('path blocked');
      }),
      sink,
    );

    await runner.onTick(10);
    await runner.onTick(200);

    expect(sink.reflexes.map((r) => [r.tick, r.outcome.result])).toEqual([
      [10, 'failed'],
      [200, 'failed'],
    ]);
  });
});
