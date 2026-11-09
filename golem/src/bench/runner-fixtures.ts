import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { ActionRegistry } from '../actions/registry.ts';
import { type CommandSource, TestControl } from '../test-control.ts';
import type { ManagerLike, RunnerDeps } from './runner.ts';
import type { Scenario } from './types.ts';

/** Fakes for the runner tests: a server that records commands, a bot, a manager and deps around them. */

const QUERY = (rate: number): string =>
  `The game is running normallyTarget tick rate: ${rate.toFixed(1)} per second.
Average time per tick: 0.2ms (Target: ${(1000 / rate).toFixed(1)}ms)Percentiles: P50: 0.2ms P95: 0.2ms P99: 0.3ms. Sample: 100`;

/** A control over a fake server: records every command and answers `tick query` for the set rate. */
export function fakeServer(opts: { queryRate?: () => number | null } = {}) {
  const commands: string[] = [];
  let rate = 20;
  const source: CommandSource = {
    async command(cmd) {
      commands.push(cmd);
      const set = /^tick rate (\d+)$/.exec(cmd);
      if (set) rate = Number(set[1]);
      if (cmd === 'tick query') return QUERY(opts.queryRate?.() ?? rate);
      return '';
    },
  };
  return {
    ctl: new TestControl(source),
    commands,
    rates: () => commands.filter((c) => c.startsWith('tick rate ')).map((c) => Number(c.slice(10))),
  };
}

export function fakeBot(): Bot & EventEmitter {
  const bot = new EventEmitter() as unknown as Bot & EventEmitter;
  Object.assign(bot, {
    time: { age: 0, timeOfDay: 6000 },
    pathfinder: {
      calls: [] as string[],
      stop() {
        this.calls.push('stop');
      },
      setGoal(goal: unknown) {
        this.calls.push(`setGoal(${goal})`);
      },
    },
    isSleeping: false,
    currentWindow: null,
  });
  return bot;
}

export function fakeManager(bot: Bot): ManagerLike & EventEmitter {
  return Object.assign(new EventEmitter(), { state: 'online', bot });
}

/** Resolves when the signal aborts, at once if it already has. */
export const untilAbort = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((r) => signal.addEventListener('abort', () => r(), { once: true }));

export const GOTO = { do: 'goto', target: { x: 1, y: 200, z: 2 } };
export const pass = async (): Promise<{ passed: boolean; note: string }> => ({
  passed: true,
  note: 'ok',
});

export function scenarioOf(partial: Partial<Scenario> & Pick<Scenario, 'run'>): Scenario {
  return {
    name: 'fake',
    description: 'fake',
    timeoutMs: 25,
    prepare: async () => undefined,
    ready: () => true,
    ...partial,
  };
}

/** Deps around a fake server and bot; the goto handler answers from `outcomes`. */
export function setup(overrides: Partial<RunnerDeps> = {}, outcomes: Array<'ok' | 'blocked'> = []) {
  const server = fakeServer();
  const bot = fakeBot();
  const manager = fakeManager(bot);
  const registry = new ActionRegistry();
  let calls = 0;
  registry.register({
    kind: 'goto',
    timeoutMs: 1_000,
    async run() {
      const next = outcomes[calls++] ?? 'ok';
      return next === 'ok'
        ? { status: 'completed', detail: {} }
        : { status: 'failed', reason: 'blocked', message: 'wall', detail: {} };
    },
  });
  const deps: RunnerDeps = {
    ctl: server.ctl,
    manager,
    registry,
    botName: 'GolemBench',
    slot: 0,
    ensurePathfinder: () => undefined,
    readyWaitMs: 100,
    settleWaitMs: 100,
    reconnectWaitMs: 400,
    ...overrides,
  };
  return { server, bot, manager, deps };
}
