import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import type { ActionRun } from '../actions/registry.ts';
import type { CommandSource } from '../test-control.ts';
import { limitedControl, type RunnerDeps, runCell, waitUntil } from './runner.ts';
import {
  fakeBot,
  fakeServer,
  GOTO,
  pass,
  scenarioOf,
  setup,
  untilAbort,
} from './runner-fixtures.ts';
import type { BenchEnv } from './types.ts';

describe('runCell', () => {
  it('reports one pass and two failures with notes, and restores the rate once', async () => {
    const { server, deps } = setup();
    let n = 0;
    const scenario = scenarioOf({
      // Throw, pass, then hang: the hang goes last because it leaves the run stuck.
      async run() {
        n++;
        if (n === 1) throw new Error('boom');
        if (n === 2) return { passed: true, note: 'fine' };
        return new Promise(() => undefined);
      },
    });
    const cell = await runCell(scenario, 5, 3, deps);
    expect(cell.runs).toBe(3);
    expect(cell.passed).toBe(1);
    expect(cell.failures).toHaveLength(2);
    expect(cell.failures[0]?.note).toBe('boom');
    expect(cell.failures[1]?.note).toMatch(/timed out after 100 ms/);
    expect(server.rates()).toEqual([5, 20]);
  });

  it('marks the rest of the cell failed when a run does not stop', async () => {
    const { deps } = setup();
    const cell = await runCell(
      scenarioOf({ run: () => new Promise(() => undefined) }),
      20,
      3,
      deps,
    );
    expect(cell.passed).toBe(0);
    expect(cell.failures.map((f) => f.note).slice(1)).toEqual([
      'previous run did not stop',
      'previous run did not stop',
    ]);
  });

  it('marks the rest of the cell failed when prepare does not stop', async () => {
    const { deps } = setup();
    const cell = await runCell(
      scenarioOf({ prepare: () => new Promise(() => undefined), run: pass }),
      20,
      3,
      deps,
    );
    expect(cell.passed).toBe(0);
    expect(cell.failures[0]?.note).toMatch(/timed out/);
    expect(cell.failures.map((f) => f.note).slice(1)).toEqual([
      'previous run did not stop',
      'previous run did not stop',
    ]);
  });

  it('sets the rate once for a 5 TPS cell with a warm-up, no 20 between runs', async () => {
    const { server, deps } = setup({ warmup: scenarioOf({ name: 'warm', run: pass }) });
    const cell = await runCell(scenarioOf({ run: pass }), 5, 3, deps);
    expect(cell.runs).toBe(3);
    expect(cell.passed).toBe(3);
    expect(server.rates()).toEqual([5, 20]);
    expect(server.commands.filter((c) => c === 'tick query').length).toBeGreaterThan(3);
  });

  it('resets the world, the bot and leftover entities before each run', async () => {
    const { server, deps } = setup();
    await runCell(scenarioOf({ run: pass }), 20, 1, deps);
    const text = server.commands.join('\n');
    expect(text).toContain('kill @e[type=minecraft:item,x=800,y=200,z=800,distance=..40]');
    expect(text).toContain('kill @e[type=minecraft:experience_orb');
    expect(text).toContain('effect give GolemBench saturation');
    // Amplifier 255 heals nothing (4 << 255 is 0 in Java ints): a small one heals 64 HP.
    expect(text).toMatch(/^effect give GolemBench (minecraft:)?instant_health 1 4$/m);
    expect(text).toContain('effect clear GolemBench');
    expect(text).toContain('clear GolemBench');
    expect(text).not.toMatch(/gamerule \S+ true/);
  });

  it('fails the run with a drift note and re-applies the rate', async () => {
    let queries = 0;
    // Query 1 is withTps confirming the rate; query 2 is the pre-run check, which drifts.
    const server = fakeServer({ queryRate: () => (++queries === 2 ? 20 : null) });
    const { deps } = setup({ ctl: server.ctl });
    const cell = await runCell(scenarioOf({ run: pass }), 5, 2, deps);
    expect(cell.failures[0]?.note).toMatch(/tick rate drifted/);
    expect(server.rates().filter((r) => r === 5).length).toBeGreaterThanOrEqual(2);
  });

  it('does not let a scenario that ignores the signal reach the registry after the abort', async () => {
    let registryCalls = 0;
    const fakeRun = async (): Promise<ActionRun> => {
      registryCalls++;
      return {
        state: 'completed',
        result: { status: 'completed', latency_ms: 1, world_ticks: 1, detail: {} },
      };
    };
    const { deps } = setup({
      runAction: fakeRun as NonNullable<RunnerDeps['runAction']>,
      settleWaitMs: 400,
    });
    let atAbort = -1;
    let runs = 0;
    const scenario = scenarioOf({
      timeoutMs: 5,
      async run(env) {
        runs++;
        if (runs > 1) return { passed: true, note: 'second' };
        env.signal.addEventListener('abort', () => {
          atAbort = registryCalls;
        });
        // Ignores the signal: keeps calling env.run for a while after the timeout.
        for (let i = 0; i < 8; i++) {
          await env.run(GOTO).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 15));
        }
        return { passed: true, note: 'late' };
      },
    });
    const cell = await runCell(scenario, 20, 2, deps);
    expect(runs).toBe(2);
    expect(cell.failures[0]?.run).toBe(1);
    // Nothing reached the registry between the abort and the end of the leaked loop.
    expect(atAbort).toBeGreaterThanOrEqual(0);
    expect(registryCalls).toBe(atAbort);
  });

  it('gives run 2 the new bot after run 1 loses its connection', async () => {
    const { bot, manager, deps } = setup();
    const second = fakeBot();
    let seen: Bot | null = null;
    let runs = 0;
    const scenario = scenarioOf({
      timeoutMs: 400,
      async run(env) {
        runs++;
        if (runs === 1) {
          manager.state = 'backoff';
          manager.emit('disconnect', { reason: 'lost' });
          setTimeout(() => {
            manager.bot = second;
            manager.state = 'online';
          }, 60);
          await untilAbort(env.signal);
          return { passed: true, note: 'unreachable' };
        }
        seen = env.bot;
        return { passed: true, note: 'ok' };
      },
    });
    const cell = await runCell(scenario, 20, 2, deps);
    expect(cell.failures).toHaveLength(1);
    expect(cell.failures[0]?.note).toMatch(/disconnected/);
    expect(cell.perRun[0]?.reconnects).toBe(1);
    expect(seen).toBe(second);
    expect(seen).not.toBe(bot);
  });

  it('records the remaining runs as failed when the bot never returns', async () => {
    const { manager, deps } = setup({ reconnectWaitMs: 100 });
    const scenario = scenarioOf({
      timeoutMs: 400,
      async run(env) {
        manager.state = 'backoff';
        manager.emit('disconnect', {});
        await untilAbort(env.signal);
        return { passed: true, note: '' };
      },
    });
    const cell = await runCell(scenario, 20, 3, deps);
    expect(cell.passed).toBe(0);
    expect(cell.failures.map((f) => f.note).slice(1)).toEqual([
      'bot did not come back online',
      'bot did not come back online',
    ]);
  });

  it('fails the run when the bot dies, and aborts the signal on a timeout', async () => {
    const { bot, deps } = setup();
    const signals: AbortSignal[] = [];
    const dying = scenarioOf({
      timeoutMs: 400,
      async run(env) {
        signals.push(env.signal);
        bot.emit('death');
        await untilAbort(env.signal);
        return { passed: true, note: '' };
      },
    });
    const cell = await runCell(dying, 20, 1, deps);
    expect(cell.failures[0]?.note).toBe('bot died');
    const slow = scenarioOf({
      async run(env) {
        signals.push(env.signal);
        await untilAbort(env.signal);
        return { passed: true, note: '' };
      },
    });
    const timed = await runCell(slow, 20, 1, deps);
    expect(timed.failures[0]?.note).toMatch(/timed out/);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('counts 3 completed and 1 blocked action per kind, and adds the last run to a timeout note', async () => {
    const { deps } = setup({}, ['ok', 'ok', 'blocked', 'ok']);
    const scenario = scenarioOf({
      timeoutMs: 40,
      async run(env) {
        for (let i = 0; i < 4; i++) await env.run(GOTO);
        return new Promise(() => undefined);
      },
    });
    const cell = await runCell(scenario, 20, 1, deps);
    expect(cell.actionStats).toEqual({ goto: { total: 4, completed: 3, failed: { blocked: 1 } } });
    expect(cell.actions).toHaveLength(4);
    expect(cell.failures[0]?.note).toMatch(/last run: goto completed elapsed=/);
  });

  it('fails the run when env.run produces an invalid result shape', async () => {
    const broken = (async () => ({
      state: 'bogus',
      result: { status: 'completed' },
    })) as unknown;
    const { deps } = setup({ runAction: broken as NonNullable<RunnerDeps['runAction']> });
    const scenario = scenarioOf({
      async run(env) {
        await env.run(GOTO);
        return { passed: true, note: 'x' };
      },
    });
    const cell = await runCell(scenario, 20, 1, deps);
    expect(cell.passed).toBe(0);
    expect(cell.failures[0]?.note).toMatch(/invalid action record/);
  });

  it('gives a scenario a limited ctl while it runs and the full one in prepare', async () => {
    const { deps } = setup();
    let prepared = '';
    const scenario = scenarioOf({
      async prepare(env) {
        await env.ctl.give('GolemBench', 'stick', 1);
        prepared = 'gave';
      },
      async run(env) {
        await env.ctl.fill({ x: 0, y: 200, z: 0 }, { x: 1, y: 200, z: 1 }, 'stone');
        await env.ctl.gamerule('spawn_mobs');
        expect(() => env.ctl.give('GolemBench', 'stick', 1)).toThrow(/not available/);
        expect(() => env.ctl.gamerule('spawn_mobs', true)).toThrow(/only query/);
        return { passed: true, note: 'limited' };
      },
    });
    const cell = await runCell(scenario, 20, 1, deps);
    expect(prepared).toBe('gave');
    expect(cell.passed).toBe(1);
  });

  it('clears the pathfinder goal after stopping it, so the next goto is not rejected', async () => {
    const { bot, deps } = setup();
    await runCell(scenarioOf({ run: pass }), 20, 1, deps);
    const calls = (bot as unknown as { pathfinder: { calls: string[] } }).pathfinder.calls;
    expect(calls).toEqual(['stop', 'setGoal(null)']);
  });

  it('stops starting runs when shouldStop turns true', async () => {
    let started = 0;
    const { deps } = setup({ shouldStop: () => started >= 2 });
    const cell = await runCell(
      scenarioOf({
        async run() {
          started++;
          return { passed: true, note: '' };
        },
      }),
      20,
      5,
      deps,
    );
    expect(cell.runs).toBe(2);
  });
});

describe('limitedControl', () => {
  it('passes the allowed calls through', async () => {
    const server = fakeServer();
    const ctl = limitedControl(server.ctl);
    await ctl.timeSet('noon');
    await ctl.effectClear('GolemBench');
    expect(server.commands).toEqual(['time set noon', 'effect clear GolemBench']);
  });
});

describe('waitUntil', () => {
  const envOf = (age: () => number, signal = new AbortController().signal) =>
    ({
      bot: {
        time: {
          get age() {
            return age();
          },
        },
      },
      signal,
      timeScale: 1,
    }) as unknown as Pick<BenchEnv, 'bot' | 'signal' | 'timeScale'>;

  it('resolves true when the predicate holds, false when world ticks run out or the signal aborts', async () => {
    let age = 0;
    const tick = setInterval(() => {
      age += 5;
    }, 5);
    try {
      expect(
        await waitUntil(
          envOf(() => age),
          () => true,
          10,
        ),
      ).toBe(true);
      expect(
        await waitUntil(
          envOf(() => age),
          () => false,
          20,
        ),
      ).toBe(false);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      expect(
        await waitUntil(
          envOf(() => 0, controller.signal),
          () => false,
          1_000,
        ),
      ).toBe(false);
    } finally {
      clearInterval(tick);
    }
  });

  it('does not time out early when the age steps by 20 from a stale start', async () => {
    let age = 0;
    const tick = setInterval(() => {
      age += 20;
    }, 60);
    try {
      // The predicate holds at age 40; the stale start would end the wait at age 20 without the slack.
      expect(
        await waitUntil(
          envOf(() => age),
          () => age >= 40,
          20,
        ),
      ).toBe(true);
    } finally {
      clearInterval(tick);
    }
  });
});
