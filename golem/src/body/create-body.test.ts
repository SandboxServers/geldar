import type { Action } from '@geldar/contract';
import type { Roll } from '@geldar/psyche';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { STALL_TEXT } from '../actions/pathing.ts';
import { type ActionRun, runAction } from '../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { createBody, enabledReflexes } from './create-body.ts';
import { planFor, scriptedProgram, thought } from './executor.fakes.ts';
import { MemorySink } from './records.ts';
import { NatsRecordSink } from './records-nats.ts';
import { allReflexesOn, REFLEX_NAMES } from './reflex-config.ts';
import { hasBlockedReport } from './reflexes/blocked-path.ts';
import { threatCallFor } from './reflexes/encounter.ts';
import { IDLE_TICKS, idleStuckReflex } from './reflexes/idle-stuck.ts';
import { createThreatPolicy } from './reflexes/threat-policy.ts';

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

describe('the time since rest is wired in createBody (decision 0225)', () => {
  it('asks the server for its statistics at once on a 26.1.2 bot that has spawned', () => {
    const write = vi.fn();
    const client = { write, on: vi.fn(), removeListener: vi.fn() };
    const bot = Object.assign(fakeBot(), { version: '26.1.2', _client: client }) as unknown as Bot;
    body({ bot });
    expect(write).toHaveBeenCalledWith('client_command', { actionId: 1 });
  });
});

const failedBlocked: ActionRun = {
  state: 'failed',
  result: {
    status: 'failed',
    reason: 'blocked',
    message: STALL_TEXT,
    latency_ms: 1,
    world_ticks: 600,
    detail: {},
  },
};
const completedRun: ActionRun = {
  state: 'completed',
  result: { status: 'completed', latency_ms: 1, world_ticks: 1, detail: {} },
};

/** A still, enclosed, day-time Body that idle_stuck would fire on after IDLE_TICKS. */
function stuckBody(view: object, tick: number): void {
  Object.assign(view, {
    tick,
    position: { x: -265.5, y: 35, z: 196.5 },
    enclosed: true,
    canStepOff: false,
    isNight: false,
    actionRunning: false,
    asleep: false,
    riding: false,
  });
}

describe('createBody ends the previous life at death', () => {
  it('cancels the running action when the bot dies, and a plan after the respawn is accepted', async () => {
    const bot = fakeBot();
    const made = body({ bot });
    const cancel = vi.spyOn(made.runtime, 'cancelAction');
    bot.emit('death');
    expect(cancel).toHaveBeenCalledTimes(1);
    bot.emit('respawn');
    // Death happened at revision 5; a snapshot taken after the respawn is at revision 6.
    const r = await made.executor.submit(
      thought({ actions: [{ do: 'wait', seconds: 1 }] }),
      planFor(1, { n: 4, snapshotRevision: 6 }),
    );
    expect(r.rejection).toBeNull();
    expect(r.actions).toHaveLength(1);
  });
});

describe('createBody clears the idle clock on respawn and restarts it after an action', () => {
  it('a respawn forgets the idle clock of the old body', () => {
    const bot = fakeBot();
    const { view } = body({ bot });
    stuckBody(view, 0);
    idleStuckReflex.check(view);
    bot.emit('respawn');
    stuckBody(view, IDLE_TICKS);
    expect(idleStuckReflex.check(view)).toBeNull();
  });

  it('a respawn forgets the open band-roll encounter, so the same hostile rolls again', () => {
    const bot = fakeBot();
    const { view } = body({ bot });
    Object.assign(view, { health: 8, tick: 0 });
    const roller = vi.fn((): Roll => ({ success: true }) as Roll);
    const policy = createThreatPolicy({ aggression: 3, combat: 0, rolls: true, rollAt: roller });
    const hit = { hostile: 'zombie', armed: true, suicideMob: false };

    expect(threatCallFor(view, policy, hit)).toMatchObject({ action: 'fight', why: 'band_roll' });
    bot.emit('respawn');
    Object.assign(view, { tick: 10 });
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a finished action restarts the idle clock from its end', async () => {
    const { runtime, view } = body();
    stuckBody(view, 0);
    idleStuckReflex.check(view);
    stuckBody(view, 1100);
    const signal = new AbortController().signal;
    // `note` is a registered handler with no world effect, so the run finishes at once.
    await runAction(runtime.actions, fakeBot(), { do: 'note', text: 'idle' } as Action, {
      signal,
      timeScale: 1,
    });
    stuckBody(view, IDLE_TICKS);
    expect(idleStuckReflex.check(view)).toBeNull();
  });
});

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
  it('reports a goto the program ran that ends failed(blocked) to the blocked-path reflex', () => {
    const b = body();
    vi.spyOn(b.executor, 'ranByProgram').mockReturnValue(true);
    b.runtime.actions.notifyFinished(
      { do: 'goto', target: { x: 10, y: 64, z: -4 } },
      failedBlocked,
    );
    expect(hasBlockedReport(b.view)).toBe(true);
  });

  it('does not report a blocked goto the program did not run (a plan action)', () => {
    const b = body();
    b.runtime.actions.notifyFinished(
      { do: 'goto', target: { x: 10, y: 64, z: -4 } },
      failedBlocked,
    );
    expect(hasBlockedReport(b.view)).toBe(false);
  });

  it('reports a goto to a player at the player position', () => {
    const bot = Object.assign(fakeBot(), {
      players: { Steve: { entity: { position: { x: 5, y: 70, z: 6 } } } },
    }) as unknown as Bot;
    const b = body({ bot });
    vi.spyOn(b.executor, 'ranByProgram').mockReturnValue(true);
    b.runtime.actions.notifyFinished({ do: 'goto', target: 'Steve' }, failedBlocked);
    expect(hasBlockedReport(b.view)).toBe(true);
  });

  it('does not report other failures, other verbs or completed walks', () => {
    const b = body();
    vi.spyOn(b.executor, 'ranByProgram').mockReturnValue(true);
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
