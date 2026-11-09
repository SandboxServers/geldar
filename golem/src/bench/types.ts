import type { Bot } from 'mineflayer';
import type { ActionRun } from '../actions/registry.ts';
import type { Arena } from '../arena.ts';
import type { TestControl } from '../test-control.ts';

/** What a scenario gets: the bot, server control, its arena, the cell's tick rate and an abort signal. */
export interface BenchEnv {
  bot: Bot;
  ctl: TestControl;
  arena: Arena;
  /** Target ticks per second of this cell. */
  tps: number;
  /** `20 / tps`: wall-clock timeouts are multiplied by it. */
  timeScale: number;
  /** Aborted on run timeout, throw or disconnect; scenarios check it in polling loops. */
  signal: AbortSignal;
  /**
   * `runAction` with the registry and `timeScale`; uses `signal` by default and rejects at once with
   * `Error('run aborted')` when aborted. Records latency and validity of every result.
   */
  run(action: unknown, opts?: { signal?: AbortSignal }): Promise<ActionRun>;
}

/** One scripted benchmark scenario (spec section 10). */
export interface Scenario {
  name: string;
  description: string;
  /** Wall ms at 20 TPS; scaled by `timeScale`. */
  timeoutMs: number;
  /** Not part of `all` and never recorded (`goto-smoke`). */
  hidden?: boolean;
  /** Builds the fixture, gives items, positions the bot (full `ctl`). */
  prepare(env: BenchEnv): Promise<void>;
  /** The fixture is visible to the bot (`bot.blockAt`, `bot.inventory`). */
  ready(env: BenchEnv): boolean;
  /** Plays the scenario. `env.ctl` is limited here to effect, effectClear, timeSet, fill, chestItems and gamerule queries. */
  run(env: BenchEnv): Promise<{ passed: boolean; note: string }>;
}

/** One finished action as the benchmark keeps it. */
export interface ActionRecordLite {
  kind: string;
  status: 'completed' | 'failed' | 'cancelled';
  reason: string | null;
  latencyMs: number;
  worldTicks: number | null;
}

/** Per action kind: how many ran, how many completed and the failures by reason. */
export interface ActionStats {
  total: number;
  completed: number;
  failed: Record<string, number>;
}

/** Server timing recorded after one run. */
export interface RunTiming {
  mspt: number | null;
  targetMspt: number | null;
  timeOfDay: number | null;
  reconnects: number;
}

/** The result of one scenario at one TPS over several runs. */
export interface CellResult {
  scenario: string;
  tps: number;
  runs: number;
  passed: number;
  actions: ActionRecordLite[];
  /** Key is the action `do`; failures by `FailReason`. */
  actionStats: Record<string, ActionStats>;
  runWallMs: number[];
  failures: { run: number; note: string }[];
  perRun: RunTiming[];
  /** One note per run, pass or fail. */
  notes: string[];
}
