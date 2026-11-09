import type { Bot } from 'mineflayer';
import type { ActionRun } from '../actions/registry.ts';
import type { Arena } from '../arena.ts';
import type { TestControl } from '../test-control.ts';
import type { RunControl } from './limited-control.ts';

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
  /**
   * Plays the scenario. `env.ctl` is limited here to effect, effectClear, timeSet, fill,
   * chestItems and gamerule queries, plus the read-only `blockIs` and `isSleeping`.
   */
  run(env: RunEnv): Promise<{ passed: boolean; note: string }>;
}

/** The env a scenario's `run` gets: `ctl` is the limited control with the read-only queries. */
export type RunEnv = BenchEnv & { ctl: RunControl };

/** One finished action as the benchmark keeps it. */
export interface ActionRecordLite {
  kind: string;
  status: 'completed' | 'failed' | 'cancelled';
  reason: string | null;
  latencyMs: number;
  /**
   * World ticks the action took. `bot.time.age` has a 20-tick resolution (decision 0038), so this
   * is a difference of two quantised values, off by up to 20 ticks: wall `latencyMs` is the
   * primary number.
   */
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
  /** Wall ms the pre-run reset took; not part of `runWallMs`. */
  resetMs: number | null;
  /** `bot.time.age` when the run started, or null without a time packet. */
  ageStart: number | null;
  /** `bot.time.age` when the run ended. */
  ageEnd: number | null;
  /**
   * Ticks per second the world really ran at: (`ageEnd` - `ageStart`) over the wall seconds
   * between the two samples. `bot.time.age` moves in steps of 20 ticks (decision 0038), so a delta
   * of under 100 ticks (5 steps) is not a measurement: the figure is null then. The per-cell
   * `achievedTps` of the summary (sum of ticks over sum of wall seconds) is the one to quote.
   */
  achievedTps: number | null;
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
