import { describe, expect, it } from 'vitest';
import type { ActionRun } from '../actions/registry.ts';
import { type CommandSource, TestControl } from '../test-control.ts';
import { type RunnerDeps, runCell } from './runner.ts';
import { fakeBot, GOTO, pass, scenarioOf, setup } from './runner-fixtures.ts';

describe('runCell run bookkeeping', () => {
  it('records the world age at the start and end of a run and the achieved TPS', async () => {
    const { bot, deps } = setup();
    const scenario = scenarioOf({
      timeoutMs: 400,
      async run() {
        await new Promise((r) => setTimeout(r, 40));
        (bot.time as { age: number }).age = 100;
        return { passed: true, note: '' };
      },
    });
    const cell = await runCell(scenario, 20, 1, deps);
    const timing = cell.perRun[0];
    expect(timing?.ageStart).toBe(0);
    expect(timing?.ageEnd).toBe(100);
    expect(timing?.achievedTps).toBeGreaterThan(0);
    expect(timing?.achievedTps).toBeLessThan(100 / 0.04);
  });

  it('fails the run as disconnected when the connection drops during the reset', async () => {
    const { server, manager, deps } = setup();
    // The fake server drops the connection while the reset commands run.
    const original = deps.ctl;
    const source: CommandSource = {
      async command(cmd) {
        if (cmd.startsWith('clear ')) {
          manager.state = 'backoff';
          manager.emit('disconnect', {});
        }
        return original.command(cmd);
      },
    };
    let ran = false;
    const scenario = scenarioOf({
      async run() {
        ran = true;
        return { passed: true, note: '' };
      },
    });
    const cell = await runCell(scenario, 20, 1, { ...deps, ctl: new TestControl(source) });
    expect(ran).toBe(false);
    expect(cell.passed).toBe(0);
    expect(cell.failures[0]?.note).toBe('disconnected');
    expect(manager.listenerCount('disconnect')).toBe(0);
    expect(server.commands.length).toBeGreaterThan(0);
  });

  it('keeps the reset out of runWallMs and records it as resetMs', async () => {
    const { deps } = setup();
    const original = deps.ctl;
    const source: CommandSource = {
      async command(cmd) {
        if (cmd.startsWith('clear ')) await new Promise((r) => setTimeout(r, 120));
        return original.command(cmd);
      },
    };
    const cell = await runCell(scenarioOf({ run: pass }), 20, 1, {
      ...deps,
      ctl: new TestControl(source),
    });
    expect(cell.runWallMs[0]).toBeLessThan(100);
    expect(cell.perRun[0]?.resetMs).toBeGreaterThanOrEqual(110);
  });
});

describe('runCell cleanup between runs', () => {
  it('closes an open window and wakes a sleeping bot, and survives a step that throws', async () => {
    const { bot, deps } = setup();
    const calls: string[] = [];
    Object.assign(bot, {
      currentWindow: { id: 3 },
      isSleeping: true,
      closeWindow() {
        calls.push('closeWindow');
        throw new Error('window already gone');
      },
      async wake() {
        calls.push('wake');
      },
    });
    const cell = await runCell(scenarioOf({ run: pass }), 20, 1, deps);
    expect(calls).toEqual(['closeWindow', 'wake']);
    expect(cell.passed).toBe(1);
  });

  it('leaves a closed window and an awake bot alone', async () => {
    const { bot, deps } = setup();
    const calls: string[] = [];
    Object.assign(bot, {
      closeWindow: () => calls.push('closeWindow'),
      wake: async () => calls.push('wake'),
    });
    await runCell(scenarioOf({ run: pass }), 20, 1, deps);
    expect(calls).toEqual([]);
  });
});

describe('runCell after the run is closed', () => {
  it('drops a late result and refuses a new call even when the scenario brings its own signal', async () => {
    let registryCalls = 0;
    const slowRun = async (): Promise<ActionRun> => {
      registryCalls++;
      await new Promise((r) => setTimeout(r, 60));
      return {
        state: 'completed',
        result: { status: 'completed', latency_ms: 1, world_ticks: 1, detail: {} },
      };
    };
    const base = setup();
    // The timing query after the close is slow, so the late result lands before the cell is read.
    let queries = 0;
    const source: CommandSource = {
      async command(cmd) {
        if (cmd === 'tick query' && ++queries >= 3) await new Promise((r) => setTimeout(r, 100));
        return base.deps.ctl.command(cmd);
      },
    };
    const deps: RunnerDeps = {
      ...base.deps,
      ctl: new TestControl(source),
      runAction: slowRun as NonNullable<RunnerDeps['runAction']>,
      settleWaitMs: 20,
    };
    const own = new AbortController();
    let secondError = '';
    const scenario = scenarioOf({
      timeoutMs: 5,
      async run(env) {
        await env.run(GOTO, { signal: own.signal }).catch(() => undefined);
        // The run was closed while the first call was in flight: this one must not start.
        await env.run(GOTO, { signal: own.signal }).catch((e: Error) => {
          secondError = e.message;
        });
        return { passed: true, note: 'late' };
      },
    });
    const cell = await runCell(scenario, 20, 1, deps);
    await new Promise((r) => setTimeout(r, 150));
    expect(cell.passed).toBe(0);
    expect(cell.actions).toEqual([]);
    expect(registryCalls).toBe(1);
    expect(secondError).toBe('run aborted');
  });
});

describe('runCell logging and tallies', () => {
  it('logs a warm-up that ran and failed, not only one that threw', async () => {
    const { deps } = setup();
    const lines: string[] = [];
    const warmup = scenarioOf({
      name: 'warm',
      async run() {
        return { passed: false, note: 'goto blocked' };
      },
    });
    await runCell(scenarioOf({ run: pass }), 20, 1, {
      ...deps,
      warmup,
      log: (l) => lines.push(l),
    });
    expect(lines).toContain('warm-up failed: goto blocked');
  });

  it('counts a cancelled action as failed with the reason cancelled', async () => {
    const cancelled = async (): Promise<ActionRun> => ({
      state: 'cancelled',
      result: { status: 'cancelled', latency_ms: 1, world_ticks: 0, detail: {} },
    });
    const { deps } = setup({ runAction: cancelled as NonNullable<RunnerDeps['runAction']> });
    const cell = await runCell(
      scenarioOf({
        async run(env) {
          await env.run(GOTO);
          await env.run(GOTO);
          return { passed: true, note: '' };
        },
      }),
      20,
      1,
      deps,
    );
    expect(cell.actionStats).toEqual({
      goto: { total: 2, completed: 0, failed: { cancelled: 2 } },
    });
  });
});
