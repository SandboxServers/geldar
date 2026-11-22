import { describe, expect, it } from 'vitest';
import type { CheckpointEntry } from './checkpoint.ts';
import { fakeId, LIFE, scriptedProgram, thought } from './executor.fakes.ts';
import { ProgramRegistry } from './program.ts';
import { createProgramRegistry } from './programs/index.ts';
import { boot, buckets, entry } from './restart.fakes.ts';

/** A registry whose only programs are the names given, each a scripted stand-in. */
function registryWith(names: string[]): ProgramRegistry {
  const registry = new ProgramRegistry();
  for (const name of names) registry.register(name, () => scriptedProgram([{ status: 'running' }]));
  return registry;
}

/** A stored entry whose checkpoint and saved intent both name `program`. */
function entryFor(program: string, over: Partial<CheckpointEntry> = {}): string {
  const intent = (thought({ intent: { program } }) as { intent: CheckpointEntry['intent'] }).intent;
  return entry({ program, intent, ...over });
}

/** A schedule the test fires by hand. */
function manualTimer() {
  const timers: Array<{ fire: () => void; ms: number }> = [];
  return {
    timers,
    schedule: (fire: () => void, ms: number) => {
      timers.push({ fire, ms });
      return () => undefined;
    },
  };
}

describe('restartBody resumes a checkpoint whose program is registered', () => {
  it.each(['explore', 'farm', 'patrol'])('resumes a saved %s intent', async (name) => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entryFor(name));
    const b = await boot(kv, { tick: 10, restart: { programs: registryWith([name]) } });
    expect(b.outcome).toEqual({ kind: 'resumed', intentId: fakeId('in', 1) });
    expect(b.body.executor.intentId).toBe(fakeId('in', 1));
    await b.stop();
  });

  it('the Body the live code builds registers explore, farm and patrol', () => {
    expect(createProgramRegistry().names()).toEqual(
      expect.arrayContaining(['explore', 'farm', 'patrol']),
    );
  });
});

describe('restartBody refuses a checkpoint whose program is not registered', () => {
  it('an unknown program is refused: idle, reason logged, no_plan wake after the wait, no throw', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entryFor('mystery', { intent_id: 'in_x' }));
    const timer = manualTimer();
    const b = await boot(kv, { tick: 10, schedule: timer.schedule });
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'unknown_program' });
    expect(b.body.executor.intentId).toBeNull();
    expect(
      b.lines.some((line) => line.includes('"mystery"') && line.includes('not registered')),
    ).toBe(true);
    expect(timer.timers.map((t) => t.ms)).toEqual([45_000]);
    timer.timers[0]?.fire();
    expect(b.records.wakes.map((w) => [w.reason, w.intentId])).toEqual([['no_plan', null]]);
    await b.stop();
  });

  it('a program removed from the registry is refused the same way, and its intent is closed', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entryFor('farm', { intent_id: 'in_farm' }));
    const timer = manualTimer();
    const b = await boot(kv, {
      tick: 10,
      schedule: timer.schedule,
      restart: { programs: registryWith(['fake', 'explore', 'patrol']) },
    });
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'unknown_program' });
    expect(b.records.intents.map((c) => [c.intentId, c.state, c.detail])).toEqual([
      ['in_farm', 'interrupted', 'body_restarted'],
    ]);
    timer.timers[0]?.fire();
    expect(b.records.wakes.map((w) => [w.reason, w.intentId])).toEqual([['no_plan', null]]);
    await b.stop();
  });
});
