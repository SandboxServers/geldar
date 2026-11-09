import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { targetOf } from '../actions/goto.ts';
import { allActions } from '../actions/index.ts';
import type { ActionRun } from '../actions/registry.ts';
import { type BodyKv, CheckpointStore } from './checkpoint.ts';
import { type ExecutorOptions, IntentExecutor } from './executor.ts';
import type { ProgramRegistry } from './program.ts';
import { createProgramRegistry } from './programs/index.ts';
import { MemorySink, type RecordSink } from './records.ts';
import { NatsRecordSink, type NatsSinkOptions } from './records-nats.ts';
import type { Reflex } from './reflex.ts';
import { allReflexesOn, isReflexEnabled, type ReflexConfig } from './reflex-config.ts';
import { createBasicReflexes } from './reflexes/basic.ts';
import { reportBlocked } from './reflexes/blocked-path.ts';
import { combatReflexes } from './reflexes/combat.ts';
import { shelterReflexes } from './reflexes/shelter.ts';
import { BodyRuntime, type TickSource } from './runtime.ts';
import type { BodyView } from './view.ts';
import { WakeTap } from './wake-conditions.ts';

/** What `createBody` is built from. */
export interface CreateBodyOptions {
  lifeId: string;
  bodyGeneration: number;
  bot: Bot;
  ticks: TickSource;
  /** The Body's current snapshot revision, read when a plan is validated. */
  currentRevision: () => number;
  /** The shard's reflex flags; a reflex that is off is not handed to the runtime. Default: all on. */
  reflexConfig?: ReflexConfig;
  /**
   * Where records go. Given, the Body writes to JetStream through a `NatsRecordSink` (it fills in
   * `lifeId` and the world tick); left out, a `MemorySink` keeps them.
   */
  nats?: Omit<NatsSinkOptions, 'lifeId' | 'worldTick'>;
  /**
   * Given, the running intent's checkpoint is saved to this bucket after each step and deleted
   * when the intent ends (`restart.ts` reads it back). Left out, nothing is saved.
   */
  checkpoints?: { kv: BodyKv; log?: (line: string) => void };
  /** The programs the executor may start. Default: `createProgramRegistry()`. */
  programs?: ProgramRegistry;
  /** Default: one built from the bot. */
  view?: BodyView;
  /** `20 / target TPS`. Default 1. */
  timeScale?: number;
  /** Passed to the executor. */
  snapshotWindow?: number;
  nearbyAgents?: ExecutorOptions['nearbyAgents'];
  now?: () => Date;
}

/** The parts of one Body, wired together. */
export interface Body {
  runtime: BodyRuntime;
  executor: IntentExecutor;
  /** The sink the runtime writes to: it forwards to `records` and tells the executor about wakes. */
  tap: WakeTap;
  /** The sink under the tap: a `NatsRecordSink` or a `MemorySink`. */
  records: RecordSink;
  /** The checkpoint writer, when checkpoints was given. */
  checkpoints: CheckpointStore | null;
}

/** The reflexes a shard config leaves on, from every reflex group. */
export function enabledReflexes(config: ReflexConfig): Reflex[] {
  return [...createBasicReflexes(), ...combatReflexes, ...shelterReflexes].filter((reflex) =>
    isReflexEnabled(config, reflex.name),
  );
}

/**
 * Builds one Body: the runtime with the enabled reflexes, every action handler and the program
 * registry; the executor on it; and the `WakeTap` between the runtime and the record sink. Does not
 * start anything: call `runtime.start()` and `executor.start()`.
 *
 * Two hooks watch every action the registry runs, whether a program, a plan or a reflex started it:
 * a `goto` that ends `failed(blocked)` is reported to the blocked-path reflex, and a completed
 * `mine`, `place` or `build` a program ran counts against the intent's block-operation limit.
 */
export function createBody(options: CreateBodyOptions): Body {
  const reflexConfig = options.reflexConfig ?? allReflexesOn();
  let runtime: BodyRuntime | null = null;
  const records: RecordSink =
    options.nats === undefined
      ? new MemorySink()
      : new NatsRecordSink({
          ...options.nats,
          lifeId: options.lifeId,
          worldTick: () => runtime?.view.tick ?? 0,
        });
  const tap = new WakeTap(records);
  const checkpoints =
    options.checkpoints === undefined
      ? null
      : new CheckpointStore({
          kv: options.checkpoints.kv,
          lifeId: options.lifeId,
          bodyGeneration: options.bodyGeneration,
          ...(options.checkpoints.log === undefined ? {} : { log: options.checkpoints.log }),
          ...(options.now === undefined ? {} : { now: options.now }),
        });
  const built = new BodyRuntime({
    lifeId: options.lifeId,
    bodyGeneration: options.bodyGeneration,
    bot: options.bot,
    ticks: options.ticks,
    sink: tap,
    reflexes: enabledReflexes(reflexConfig),
    reflexConfig,
    programs: options.programs ?? createProgramRegistry(),
    ...(options.view === undefined ? {} : { view: options.view }),
    ...(options.timeScale === undefined ? {} : { timeScale: options.timeScale }),
  });
  runtime = built;
  for (const handler of allActions) built.actions.register(handler);
  const executor = new IntentExecutor({
    runtime: built,
    ticks: options.ticks,
    currentRevision: options.currentRevision,
    wakeTap: tap,
    ...(checkpoints === null ? {} : { observer: checkpoints }),
    ...(options.snapshotWindow === undefined ? {} : { snapshotWindow: options.snapshotWindow }),
    ...(options.nearbyAgents === undefined ? {} : { nearbyAgents: options.nearbyAgents }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  built.actions.onFinished((action, run) => {
    if (!isAction(action)) return;
    reportBlockedWalk(built, executor, action, run);
    executor.noteAction(action, run);
  });
  return { runtime: built, executor, tap, records, checkpoints };
}

/** True for a value that names a verb; `runAction` also reports actions that failed validation. */
function isAction(value: unknown): value is Action {
  return typeof value === 'object' && value !== null && typeof (value as Action).do === 'string';
}

/** Tells the blocked-path reflex when a `goto` ended `failed(blocked)`. */
function reportBlockedWalk(
  runtime: BodyRuntime,
  executor: IntentExecutor,
  action: Action,
  run: ActionRun,
): void {
  if (action.do !== 'goto' || run.state !== 'failed' || run.result.reason !== 'blocked') return;
  // The same aim `goto` walked to: the block centre within 1, or a player's position within 2.
  const target = targetOf(action);
  let goal: { x: number; y: number; z: number };
  let range: number;
  if (target.kind === 'position') {
    goal = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
    range = 1;
  } else {
    const at = runtime.bot.players[target.name]?.entity?.position;
    if (!at) return;
    goal = { x: at.x, y: at.y, z: at.z };
    range = 2;
  }
  reportBlocked(runtime.view, {
    goal,
    range,
    intentId: executor.intentId,
    ...(run.result.message === undefined ? {} : { message: run.result.message }),
  });
}
