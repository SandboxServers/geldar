import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { ActionRun } from '../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { createBody, enabledReflexes } from './create-body.ts';
import { planFor, scriptedProgram, thought } from './executor.fakes.ts';
import { MemorySink } from './records.ts';
import { NatsRecordSink } from './records-nats.ts';
import { allReflexesOn, REFLEX_NAMES } from './reflex-config.ts';
import { hasBlockedReport } from './reflexes/blocked-path.ts';

const LIFE = 'ag_test_01';

/** A body over fakes; `view` is returned so a test can read what the reflexes were told. */
function body(opts: { bot?: Bot } = {}) {
  const ticks = manualTicks();
  const view = fakeView();
  const made = createBody({
    lifeId: LIFE,
    bodyGeneration: 3,
    bot: opts.bot ?? fakeBot(),
    ticks: ticks.source,
    currentRevision: () => 5,
    view,
  });
  return { ...made, ticks, view };
}

const failedBlocked: ActionRun = {
  state: 'failed',
  result: {
    status: 'failed',
    reason: 'blocked',
    message: 'no movement for 600 world ticks',
    latency_ms: 1,
    world_ticks: 600,
    detail: {},
  },
};
const completedRun: ActionRun = {
  state: 'completed',
  result: { status: 'completed', latency_ms: 1, world_ticks: 1, detail: {} },
};

describe('enabledReflexes', () => {
  it('hands over all seven reflexes with every flag on', () => {
    const names = enabledReflexes(allReflexesOn()).map((reflex) => reflex.name);
    expect([...names].sort()).toEqual([...REFLEX_NAMES].sort());
  });

  it('leaves out a reflex whose flag is off and all of them when the shard is off', () => {
    const config = allReflexesOn();
    config.flags.eat = false;
    config.flags.panic_burrow = false;
    const names = enabledReflexes(config).map((reflex) => reflex.name);
    expect(names).not.toContain('eat');
    expect(names).not.toContain('panic_burrow');
    expect(names).toHaveLength(REFLEX_NAMES.length - 2);
    expect(enabledReflexes({ ...allReflexesOn(), enabled: false })).toEqual([]);
  });
});

describe('createBody composition', () => {
  it('builds the runtime on the wake tap over a memory sink, with programs and action handlers', () => {
    const b = body();
    expect(b.runtime.sink).toBe(b.tap);
    expect(b.records).toBeInstanceOf(MemorySink);
    expect(b.runtime.programs.names()).toEqual(
      expect.arrayContaining(['travel', 'gather', 'craft', 'rest', 'flee', 'follow']),
    );
    expect(b.runtime.actions.kinds()).toEqual(expect.arrayContaining(['goto', 'mine', 'place']));
    expect(b.runtime.reflexRunner).toBeDefined();
  });

  it('writes to a NatsRecordSink when nats options are given', () => {
    const made = createBody({
      lifeId: LIFE,
      bodyGeneration: 3,
      bot: fakeBot(),
      ticks: manualTicks().source,
      currentRevision: () => 5,
      view: fakeView(),
      nats: { publisher: { publish: async () => undefined }, shard: 'phase0' },
    });
    expect(made.records).toBeInstanceOf(NatsRecordSink);
    expect(made.runtime.sink).toBe(made.tap);
  });

  it('lets a reflex_danger wake through the tap end the running intent', async () => {
    const b = body();
    const program = scriptedProgram([{ status: 'running' }]);
    b.runtime.programs.register('fake', () => program);
    await b.executor.submit(thought({ intent: {} }), planFor(0));
    expect(b.executor.intentState).toBe('running');

    b.runtime.sink.wake({ reason: 'reflex_danger', tick: 1, intentId: null });
    await b.executor.onTick(1);

    expect(b.executor.intentId).toBeNull();
    expect((b.records as MemorySink).wakes.map((w) => w.reason)).toEqual(['reflex_danger']);
  });
});

describe('blocked walks', () => {
  it('reports a goto that ends failed(blocked) to the blocked-path reflex', () => {
    const b = body();
    b.runtime.actions.notifyFinished(
      { do: 'goto', target: { x: 10, y: 64, z: -4 } },
      failedBlocked,
    );
    expect(hasBlockedReport(b.view)).toBe(true);
  });

  it('reports a goto to a player at the player position', () => {
    const bot = Object.assign(fakeBot(), {
      players: { Steve: { entity: { position: { x: 5, y: 70, z: 6 } } } },
    }) as unknown as Bot;
    const b = body({ bot });
    b.runtime.actions.notifyFinished({ do: 'goto', target: 'Steve' }, failedBlocked);
    expect(hasBlockedReport(b.view)).toBe(true);
  });

  it('does not report other failures, other verbs or completed walks', () => {
    const b = body();
    const goto = { do: 'goto', target: { x: 1, y: 2, z: 3 } };
    b.runtime.actions.notifyFinished(goto, completedRun);
    b.runtime.actions.notifyFinished(goto, {
      ...failedBlocked,
      result: { ...failedBlocked.result, reason: 'timeout' },
    });
    b.runtime.actions.notifyFinished(
      { do: 'place', block: 'dirt', at: { x: 1, y: 2, z: 3 } },
      failedBlocked,
    );
    b.runtime.actions.notifyFinished('nonsense', failedBlocked);
    expect(hasBlockedReport(b.view)).toBe(false);
  });
});

describe('block operation counting', () => {
  it('tells the executor about every action the registry finishes', () => {
    const b = body();
    const noted = vi.spyOn(b.executor, 'noteAction');
    const mine = { do: 'mine', block: 'oak_log', count: 5 };
    b.runtime.actions.notifyFinished(mine, completedRun);
    b.runtime.actions.notifyFinished('nonsense', completedRun);
    expect(noted).toHaveBeenCalledTimes(1);
    expect(noted).toHaveBeenCalledWith(mine, completedRun);
  });
});

describe('blocked walks with the reflex off', () => {
  it('does not report a blocked goto when blocked_path is off, so no program waits for it', () => {
    const ticks = manualTicks();
    const view = fakeView();
    const reflexConfig = allReflexesOn();
    reflexConfig.flags.blocked_path = false;
    const made = createBody({
      lifeId: LIFE,
      bodyGeneration: 3,
      bot: fakeBot(),
      ticks: ticks.source,
      currentRevision: () => 5,
      view,
      reflexConfig,
    });
    made.runtime.actions.notifyFinished(
      { do: 'goto', target: { x: 10, y: 64, z: -4 } },
      failedBlocked,
    );
    expect(hasBlockedReport(view)).toBe(false);
  });
});
