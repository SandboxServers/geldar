import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { ensurePathfinder } from '../actions/pathing.ts';
import { type ActionRegistry, type ActionRun, runAction } from '../actions/registry.ts';
import { buildArena, quietWorld } from '../arena.ts';
import type { TestControl } from '../test-control.ts';
import { ulid } from '../ulid.ts';
import { parseMspt, parseTargetMspt, parseTargetRate, setTps, withTps } from './tps.ts';
import type {
  ActionRecordLite,
  ActionStats,
  BenchEnv,
  CellResult,
  RunTiming,
  Scenario,
} from './types.ts';

export type { CellResult } from './types.ts';

/** The part of `ConnectionManager` the runner uses (a fake in tests). */
export interface ManagerLike {
  state: string;
  bot: Bot | null;
  on(event: string, handler: (arg?: unknown) => void): unknown;
  off(event: string, handler: (arg?: unknown) => void): unknown;
}

/** What `runCell` needs besides the scenario, the rate and the run count. */
export interface RunnerDeps {
  ctl: TestControl;
  manager: ManagerLike;
  registry: ActionRegistry;
  /** The bench bot's player name. */
  botName: string;
  /** Arena slot for every run. */
  slot: number;
  /** The unrecorded warm-up scenario (`goto-smoke`); none skips the warm-up. */
  warmup?: Scenario;
  /** One flushed line per finished run. */
  log?: (line: string) => void;
  /** True once `--max-minutes` is spent: no new run starts. */
  shouldStop?: () => boolean;
  /** Replaceable in tests. */
  runAction?: typeof runAction;
  ensurePathfinder?: (bot: Bot) => void;
  readyWaitMs?: number;
  settleWaitMs?: number;
  reconnectWaitMs?: number;
}

const POLL_MS = 50;
/** `bot.time.age` changes only when the server sends a time update, every 20 ticks (decision 0038). */
export const WORLD_AGE_RESOLUTION_TICKS = 20;
const DEFAULT_READY_MS = 10_000;
const DEFAULT_SETTLE_MS = 10_000;
const DEFAULT_RECONNECT_MS = 60_000;
/** The only `ctl` methods a scenario may call while it runs. */
const RUN_PHASE_CONTROL = new Set(['effect', 'effectClear', 'timeSet', 'fill', 'chestItems']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A view of `ctl` for a scenario's `run`: effect, effectClear, timeSet, fill, chestItems and
 * gamerule queries (no value). Anything else throws, so a scenario cannot give itself items.
 */
export function limitedControl(ctl: TestControl): TestControl {
  return new Proxy(ctl, {
    get(target, prop, receiver) {
      if (prop === 'gamerule') {
        return (name: string, value?: boolean | number) => {
          if (value !== undefined)
            throw new Error('ctl.gamerule can only query while a scenario runs');
          return target.gamerule(name);
        };
      }
      if (typeof prop === 'string' && !RUN_PHASE_CONTROL.has(prop)) {
        throw new Error(`ctl.${prop} is not available while a scenario runs`);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** World age of the bot, or null before the first time packet. */
function worldAge(bot: Bot): number | null {
  const age: unknown = bot.time?.age;
  return typeof age === 'number' && Number.isFinite(age) ? age : null;
}

/**
 * The polling helper for scenarios: true as soon as `predicate` holds; false when `maxWorldTicks`
 * of world age pass first or `env.signal` aborts. Polls every 50 ms of wall time.
 */
export async function waitUntil(
  env: Pick<BenchEnv, 'bot' | 'signal' | 'timeScale'>,
  predicate: () => boolean,
  maxWorldTicks: number,
): Promise<boolean> {
  const start = worldAge(env.bot);
  const wallStart = Date.now();
  // Without a world clock, fall back to the wall time the ticks would take at this rate.
  const wallLimit = maxWorldTicks * 50 * env.timeScale;
  for (;;) {
    if (env.signal.aborted) return false;
    if (predicate()) return true;
    const age = worldAge(env.bot);
    if (start !== null && age !== null) {
      // The age only changes every 20 ticks, so `start` can be up to 19 ticks stale: allow for it.
      if (age - start >= maxWorldTicks + (WORLD_AGE_RESOLUTION_TICKS - 1)) return false;
    } else if (Date.now() - wallStart >= wallLimit) {
      return false;
    }
    await sleep(POLL_MS);
  }
}

/** One finished run, before it goes into the cell. */
interface RunReport {
  passed: boolean;
  note: string;
  wallMs: number;
  timing: RunTiming;
  actions: ActionRecordLite[];
  /** The scenario promise never settled after the abort. */
  stuck: boolean;
}

/** The synthetic record `env.run` validates: a cheap regression check of the result shape. */
function checkRecordShape(action: unknown, run: ActionRun): void {
  const body = typeof action === 'object' && action !== null ? { ...action } : {};
  const kind = String((body as { do?: unknown }).do ?? 'unknown');
  delete (body as { do?: unknown }).do;
  const verdict = validateActionRecord({
    action_id: `ac_${ulid()}`,
    intent_id: null,
    life_id: 'ag_bench_01',
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: `sn_${ulid()}`,
    snapshot_revision: 1,
    expires_tick: 24_000,
    kind,
    args: body,
    state: run.state,
    result: { ...run.result },
    receipt_id: null,
  });
  if (!verdict.ok) throw new Error(`invalid action record: ${verdict.errors[0] ?? 'unknown'}`);
}

/** Waits until the manager is online with a bot, up to `maxMs`; returns that bot or null. */
async function waitForBot(manager: ManagerLike, maxMs: number): Promise<Bot | null> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    if (manager.state === 'online' && manager.bot) return manager.bot;
    if (manager.state === 'fatal' || manager.state === 'stopped') return null;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

/** Describes the last `env.run` result for a timeout note. */
function lastRunText(actions: ActionRecordLite[], last: ActionRun | null): string {
  if (!last) return 'no env.run call yet';
  const action = actions.at(-1);
  const reason = last.result.reason ? ` reason=${last.result.reason}` : '';
  return `last run: ${action?.kind ?? '?'} ${last.result.status}${reason} elapsed=${last.result.latency_ms}ms`;
}

/** Puts the world and the bot back to a known state before a run. */
async function resetBench(deps: RunnerDeps): Promise<ReturnType<typeof buildArena>> {
  const { ctl, botName } = deps;
  await quietWorld(ctl);
  const arena = await buildArena(ctl, deps.slot);
  const { x, z } = arena.center;
  await ctl.command(`kill @e[type=minecraft:item,x=${x},y=200,z=${z},distance=..40]`);
  await ctl.command(`kill @e[type=minecraft:experience_orb,x=${x},y=200,z=${z},distance=..40]`);
  await ctl.tp(botName, x, arena.center.y + 1, z);
  await ctl.clear(botName);
  // Clear first: the effect commands below must not be wiped before they act.
  await ctl.effectClear(botName);
  await ctl.effect(botName, 'saturation', 1, 255);
  await ctl.effect(botName, 'instant_health', 1, 255);
  return arena;
}

/** Stops the bot's work between runs: pathfinder, open window, sleep. Each step may fail alone. */
async function cleanupBot(bot: Bot): Promise<void> {
  const steps: Array<() => unknown> = [
    // stop() alone leaves a flag that rejects the next goto as PathStopped; setGoal(null) consumes it.
    () => {
      bot.pathfinder?.stop();
      bot.pathfinder?.setGoal(null);
    },
    () => {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    },
    async () => {
      if (bot.isSleeping) await bot.wake();
    },
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      // Cleanup must not fail the run.
    }
  }
}

/** Plays one run of a scenario: prepare, wait for the fixture, run against a timeout. */
async function playRun(
  scenario: Scenario,
  tps: number,
  deps: RunnerDeps,
  bot: Bot,
): Promise<RunReport> {
  const timeScale = 20 / tps;
  const started = Date.now();
  const controller = new AbortController();
  const actions: ActionRecordLite[] = [];
  let lastRun: ActionRun | null = null;
  let closed = false;
  let disconnects = 0;
  let died = false;
  let abortNote: string | null = null;
  const doRun = deps.runAction ?? runAction;
  const arena = await resetBench(deps);
  const ageStart = worldAge(bot);
  const ageWallStart = Date.now();

  const onDisconnect = (): void => {
    disconnects++;
    abortNote ??= 'disconnected';
    controller.abort();
  };
  const onDeath = (): void => {
    died = true;
    abortNote ??= 'bot died';
    controller.abort();
  };
  deps.manager.on('disconnect', onDisconnect);
  bot.once('death', onDeath);

  const env: BenchEnv = {
    bot,
    ctl: deps.ctl,
    arena,
    tps,
    timeScale,
    signal: controller.signal,
    async run(action, opts = {}) {
      const signal = opts.signal ?? controller.signal;
      if (signal.aborted || closed) throw new Error('run aborted');
      const result = await doRun(deps.registry, bot, action, { timeScale, signal });
      lastRun = result;
      checkRecordShape(action, result);
      if (!closed) {
        actions.push({
          kind: String((action as { do?: unknown } | null)?.do ?? 'unknown'),
          status: result.result.status,
          reason: result.result.reason ?? null,
          latencyMs: result.result.latency_ms,
          worldTicks: result.result.world_ticks,
        });
      }
      return result;
    },
  };

  let passed = false;
  let note = '';
  let scenarioPromise: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await deps.ctl.tickQuery();
    if (parseTargetRate(reply) !== tps) {
      await setTps(deps.ctl, tps);
      throw new Error(`tick rate drifted: ${reply.trim()}`);
    }
    const budgetMs = scenario.timeoutMs * timeScale;
    const aborted = new Promise<'aborted'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    // Races `work` against the scenario's wall budget and the run's abort signal.
    const guarded = async <T>(work: Promise<T>): Promise<T> => {
      const deadline = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budgetMs);
      });
      const wrapped = work.then((value) => ({ value }));
      wrapped.catch(() => undefined);
      try {
        const first = await Promise.race([wrapped, deadline, aborted]);
        if (first === 'timeout') throw new Error(`timed out after ${Math.round(budgetMs)} ms`);
        if (first === 'aborted') throw new Error(abortNote ?? 'run aborted');
        return first.value;
      } finally {
        clearTimeout(timer);
      }
    };
    await guarded(Promise.resolve().then(() => scenario.prepare(env)));
    const readyBy = Date.now() + (deps.readyWaitMs ?? DEFAULT_READY_MS);
    while (!scenario.ready(env)) {
      if (Date.now() >= readyBy) throw new Error('fixture not ready within the wait');
      if (controller.signal.aborted) throw new Error(abortNote ?? 'run aborted');
      await sleep(POLL_MS);
    }
    scenarioPromise = Promise.resolve().then(() =>
      scenario.run({ ...env, ctl: limitedControl(deps.ctl) }),
    );
    const outcome = await guarded(scenarioPromise as Promise<{ passed: boolean; note: string }>);
    passed = outcome.passed;
    note = outcome.note;
  } catch (error) {
    passed = false;
    const text = error instanceof Error ? error.message : String(error);
    note = text.startsWith('timed out') ? `${text}; ${lastRunText(actions, lastRun)}` : text;
  } finally {
    clearTimeout(timer);
    deps.manager.off('disconnect', onDisconnect);
  }
  if (disconnects > 0 && passed) {
    passed = false;
    note = `disconnected during the run; ${note}`;
  }
  if (died && passed) {
    passed = false;
    note = `bot died during the run; ${note}`;
  }

  // Stop whatever the scenario is still doing, then give it a moment to notice.
  let stuck = false;
  if (scenarioPromise) {
    const settled = scenarioPromise.then(
      () => true,
      () => true,
    );
    const waitMs = deps.settleWaitMs ?? DEFAULT_SETTLE_MS;
    controller.abort();
    stuck = !(await Promise.race([settled, sleep(waitMs).then(() => false)]));
  }
  controller.abort();
  closed = true;
  bot.off('death', onDeath);
  await cleanupBot(bot);

  const timing: RunTiming = {
    mspt: null,
    targetMspt: null,
    timeOfDay: null,
    reconnects: disconnects,
    ageStart,
    ageEnd: worldAge(bot),
    achievedTps: null,
  };
  const wallSeconds = (Date.now() - ageWallStart) / 1000;
  if (ageStart !== null && timing.ageEnd !== null && wallSeconds > 0) {
    timing.achievedTps = (timing.ageEnd - ageStart) / wallSeconds;
  }
  try {
    const reply = await deps.ctl.tickQuery();
    timing.mspt = parseMspt(reply);
    timing.targetMspt = parseTargetMspt(reply);
  } catch {
    // Timing is optional.
  }
  const timeOfDay: unknown = bot.time?.timeOfDay;
  timing.timeOfDay = typeof timeOfDay === 'number' ? timeOfDay : null;
  return { passed, note, wallMs: Date.now() - started, timing, actions, stuck };
}

/** The per-kind counts of a cell's actions. */
function tally(actions: ActionRecordLite[]): Record<string, ActionStats> {
  const stats: Record<string, ActionStats> = {};
  for (const action of actions) {
    const entry = stats[action.kind] ?? { total: 0, completed: 0, failed: {} };
    stats[action.kind] = entry;
    entry.total++;
    if (action.status === 'completed') entry.completed++;
    else if (action.status === 'failed') {
      const reason = action.reason ?? 'unknown';
      entry.failed[reason] = (entry.failed[reason] ?? 0) + 1;
    }
  }
  return stats;
}

/**
 * One scenario at one TPS: an unrecorded warm-up, then `runs` runs at that rate. The rate is set
 * once and put back to 20 once; a throw, a timeout or a disconnect fails that run with a note and
 * never aborts the cell. `restoreWorld` is the caller's `finally`, after this returns.
 */
export async function runCell(
  scenario: Scenario,
  tps: number,
  runs: number,
  deps: RunnerDeps,
): Promise<CellResult> {
  const log = deps.log ?? (() => undefined);
  const cell: CellResult = {
    scenario: scenario.name,
    tps,
    runs: 0,
    passed: 0,
    actions: [],
    actionStats: {},
    runWallMs: [],
    failures: [],
    perRun: [],
    notes: [],
  };
  const record = (report: RunReport | { passed: false; note: string }): void => {
    const run = cell.runs + 1;
    cell.runs = run;
    const full = 'timing' in report ? report : null;
    if (report.passed) cell.passed++;
    else cell.failures.push({ run, note: report.note });
    cell.notes.push(report.note);
    cell.runWallMs.push(full?.wallMs ?? 0);
    cell.perRun.push(
      full?.timing ?? {
        mspt: null,
        targetMspt: null,
        timeOfDay: null,
        reconnects: 0,
        ageStart: null,
        ageEnd: null,
        achievedTps: null,
      },
    );
    if (full) cell.actions.push(...full.actions);
    log(
      `${scenario.name} ${tps}TPS run ${run}/${runs} ${report.passed ? 'pass' : 'FAIL'} ${full?.wallMs ?? 0}ms ${report.note}`,
    );
  };

  await withTps(deps.ctl, tps, async () => {
    let blockedNote: string | null = null;
    const prepareBot = async (): Promise<Bot | null> => {
      const bot = await waitForBot(deps.manager, deps.reconnectWaitMs ?? DEFAULT_RECONNECT_MS);
      if (bot) (deps.ensurePathfinder ?? ensurePathfinder)(bot);
      return bot;
    };
    if (deps.warmup) {
      try {
        const bot = await prepareBot();
        if (bot) await playRun(deps.warmup, tps, deps, bot);
      } catch (error) {
        log(`warm-up failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (let i = 0; i < runs; i++) {
      if (deps.shouldStop?.()) break;
      if (blockedNote) {
        record({ passed: false, note: blockedNote });
        continue;
      }
      try {
        const bot = await prepareBot();
        if (!bot) {
          blockedNote = 'bot did not come back online';
          record({ passed: false, note: blockedNote });
          continue;
        }
        const report = await playRun(scenario, tps, deps, bot);
        record(report);
        if (report.stuck) blockedNote = 'previous run did not stop';
      } catch (error) {
        record({ passed: false, note: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  cell.actionStats = tally(cell.actions);
  return cell;
}
