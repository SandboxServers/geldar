import { describe, expect, it } from 'vitest';
import { type CommandSource, TestControl } from '../test-control.ts';
import { runCell } from './runner.ts';
import { fakeBot, pass, scenarioOf, setup } from './runner-fixtures.ts';

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
