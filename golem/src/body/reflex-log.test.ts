import { describe, expect, it } from 'vitest';
import type { DiagSink } from '../actions/stall-diag.ts';
import { MemorySink } from './records.ts';
import { type Reflex, type ReflexContext, ReflexRunner } from './reflex.ts';
import { allReflexesOn } from './reflex-config.ts';
import type { BodyView } from './view.ts';

/** A reflex that always fires (its check) and whose run is the given function. */
function reflexWith(run: Reflex['run']): Reflex {
  return { name: 'eat', priority: 1, cooldownTicks: 100, check: () => ({ hunger: 4 }), run };
}

/** A runner over one reflex, with a diagnostic sink that keeps every line it is given. */
function runnerFor(reflex: Reflex, view: BodyView, lines: string[]): ReflexRunner {
  const diag: DiagSink = {
    log: (line) => {
      lines.push(line);
    },
    now: () => 0,
  };
  return new ReflexRunner({
    reflexes: [reflex],
    config: allReflexesOn(),
    view,
    sink: new MemorySink(),
    lifeId: 'life-7',
    bodyGeneration: 3,
    context: () => ({}) as ReflexContext,
    diag,
  });
}

describe('ReflexRunner: one reflex_fired log line per firing, with where the Body was', () => {
  it('writes the firing with the exact position to one decimal and the dimension', async () => {
    const lines: string[] = [];
    const view = {
      exactPosition: { x: 12.34, y: 64.96, z: -133.27 },
      dimension: 'minecraft:overworld',
    } as unknown as BodyView;
    const runner = runnerFor(
      reflexWith(async () => ({ result: 'handled', detail: 'ate' })),
      view,
      lines,
    );
    await runner.onTick(40);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      event: 'reflex_fired',
      life_id: 'life-7',
      name: 'eat',
      tick: 40,
      trigger: { hunger: 4 },
      result: 'handled',
      detail: 'ate',
      x: 12.3,
      y: 65,
      z: -133.3,
      dimension: 'minecraft:overworld',
    });
  });

  it('still logs when the view has no position: the place fields are null', async () => {
    const lines: string[] = [];
    const runner = runnerFor(
      reflexWith(async () => ({ result: 'handled' })),
      {} as BodyView,
      lines,
    );
    await runner.onTick(40);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      event: 'reflex_fired',
      result: 'handled',
      detail: null,
      x: null,
      y: null,
      z: null,
      dimension: null,
    });
  });

  it('logs a run that throws as failed, with the error text', async () => {
    const lines: string[] = [];
    const runner = runnerFor(
      reflexWith(async () => {
        throw new Error('boom');
      }),
      {} as BodyView,
      lines,
    );
    await runner.onTick(40);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ result: 'failed' });
    expect(JSON.parse(lines[0] ?? '').detail).toContain('boom');
  });

  it('writes one line per firing, not one per tick while the reflex is on cooldown', async () => {
    const lines: string[] = [];
    const runner = runnerFor(
      reflexWith(async () => ({ result: 'handled' })),
      {} as BodyView,
      lines,
    );
    await runner.onTick(40);
    await runner.onTick(41);
    await runner.onTick(42);
    expect(lines).toHaveLength(1);
  });
});
