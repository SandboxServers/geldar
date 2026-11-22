import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { breakHandler } from '../actions/break.ts';
import { editSignHandler } from '../actions/edit-sign.ts';
import { targetOf } from '../actions/goto.ts';
import { allActions } from '../actions/index.ts';
import type { ActionRun } from '../actions/registry.ts';
import { useHandler } from '../actions/use.ts';
import { setSwimEnabled } from '../actions/water-rules.ts';
import type { PlanQueueStore } from '../building/queue.ts';
import { planHandler } from '../building/queue-action.ts';
import type { WallClock } from '../building/tps-estimate.ts';
import { createPlanSource } from '../building/wire-expand.ts';
import { createLaneWiring, type LaneWiring } from '../building/wire-lane.ts';
import {
  createSeenWiring,
  type SeenWiring,
  type SeenWiringOptions,
} from '../building/wire-seen.ts';
import type { GolemMetrics } from '../metrics.ts';
import { type BodyKv, CheckpointStore } from './checkpoint.ts';
import { cancelForDeath, type DeathTarget } from './death-cancel.ts';
import { type ExecutorOptions, IntentExecutor } from './executor.ts';
import { InflightStore } from './inflight.ts';
import type { ProgramRegistry } from './program.ts';
import { createProgramRegistry } from './programs/index.ts';
import { MemorySink, type RecordSink } from './records.ts';
import { NatsRecordSink, type NatsSinkOptions } from './records-nats.ts';
import type { Reflex } from './reflex.ts';
import { allReflexesOn, isReflexEnabled, type ReflexConfig } from './reflex-config.ts';
import { createBasicReflexes } from './reflexes/basic.ts';
import { reportBlocked } from './reflexes/blocked-path.ts';
import { combatReflexes, createCombatReflexes } from './reflexes/combat.ts';
import { forgetThreatEncounter } from './reflexes/encounter.ts';
import { noteActionEnd, resetIdleStuck } from './reflexes/idle-stuck.ts';
import { forgetBurrow } from './reflexes/panic-burrow.ts';
import { forgetShelterBackoff, shelterReflexes } from './reflexes/shelter.ts';
import type { ThreatPolicy } from './reflexes/threat-policy.ts';
import { noteGoto, noteWalkOutcome, resetStuck } from './reflexes/unstick.ts';
import { watchRestStat } from './rest-stat.ts';
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
  /** The shard's `body_actions.edit_sign` flag; the verb is refused while off. Default: off. */
  editSign?: boolean;
  /** The shard's `body_actions.use` flag; the verb is refused while off. Default: off (decision 0218). */
  use?: boolean;
  /** The shard's `body_actions.building` flag; break and plan are refused while off. Default: off. */
  building?: boolean;
  /** The seen store's bucket and the predecessor life; with the building flag on only. Left out: in memory. */
  seen?: Partial<Pick<SeenWiringOptions, 'kv' | 'agentId' | 'predecessor' | 'log'>>;
  /** Where queued plans and plan progress are stored (wire-plan-store); with the building flag on only. */
  planStore?: PlanQueueStore;
  /** Wall-clock ms for the plan's TPS estimate and progress cadence. Default: Date.now. Tests inject one. */
  wallClock?: WallClock;
  /** The Body's metrics (metrics.ts); the plan and seen counters are fed from them. Default: none kept. */
  metrics?: GolemMetrics;
  /** The shard's `body_actions.swim` flag; the goto swim and the bank exit are off while off. Default: off (decision 0194). */
  swim?: boolean;
  /**
   * The life's threat policy (AN-12a). Given, the combat reflexes are built on it; left out, the
   * legacy combat reflexes are handed over as before.
   */
  threat?: ThreatPolicy;
  /**
   * Where records go. Given, the Body writes to JetStream through a `NatsRecordSink` (it fills in
   * `lifeId` and the world tick); left out, a `MemorySink` keeps them.
   */
  nats?: Omit<NatsSinkOptions, 'lifeId' | 'worldTick'>;
  /** Wraps the record sink under the tap (Adam's `RecentEvents` digest); `Body.records` stays the inner sink. */
  wrapRecords?: (inner: RecordSink) => RecordSink;
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
  /** The plan queue and lane, when body_actions.building is on; null when it is off. */
  plan: LaneWiring | null;
  /** The seen-block map and its store, when body_actions.building is on; null when it is off. */
  seen: SeenWiring | null;
}

/**
 * The reflexes a shard config leaves on, from every reflex group. With a threat policy the combat
 * reflexes are built on it; without one the shared legacy `combatReflexes` are used.
 */
export function enabledReflexes(config: ReflexConfig, threat?: ThreatPolicy): Reflex[] {
  const combat = threat === undefined ? combatReflexes : createCombatReflexes(threat);
  return [...createBasicReflexes(), ...combat, ...shelterReflexes].filter((reflex) =>
    isReflexEnabled(config, reflex.name),
  );
}

/**
 * Builds one Body: the runtime with the enabled reflexes, every action handler and the program
 * registry; the executor on it; and the `WakeTap` between the runtime and the record sink. Does not
 * start anything: call `runtime.start()` and `executor.start()`.
 *
 * Two hooks watch every action the registry runs, whether a program, a plan or a reflex started it:
 * a `goto` the running program ran that ends `failed(blocked)` is reported to the blocked-path
 * reflex (a plan's own `goto` is the Mind's to handle), and a completed
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
  // The wrapper sees every record on its way to `records`; `records` stays the flushable sink.
  const tap = new WakeTap(options.wrapRecords?.(records) ?? records);
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
  // The give marker lives where the checkpoints live, and only when they are kept.
  const inflight =
    options.checkpoints === undefined
      ? undefined
      : new InflightStore({
          kv: options.checkpoints.kv,
          lifeId: options.lifeId,
          sink: tap,
          flushable: records,
          ...(options.checkpoints.log === undefined ? {} : { log: options.checkpoints.log }),
        });
  // The plan lane is built only with body_actions.building on; it steps after the reflexes each tick.
  let plan: LaneWiring | null = null;
  const built = new BodyRuntime({
    lifeId: options.lifeId,
    bodyGeneration: options.bodyGeneration,
    bot: options.bot,
    ticks: options.ticks,
    sink: tap,
    ...(inflight === undefined ? {} : { inflight }),
    reflexes: enabledReflexes(reflexConfig, options.threat),
    reflexConfig,
    programs: options.programs ?? createProgramRegistry(),
    ...(options.view === undefined ? {} : { view: options.view }),
    ...(options.timeScale === undefined ? {} : { timeScale: options.timeScale }),
    ...(options.building === true
      ? {
          tickHook: async (tick: number, reflexBusy: boolean) => {
            await plan?.onTick(tick, reflexBusy);
          },
        }
      : {}),
  });
  runtime = built;
  // The swim flag is read by goto and the planner at walk time; set it before the first walk.
  setSwimEnabled(options.bot, options.swim ?? false);
  // edit_sign is registered with the shard's flag (`body_actions.edit_sign`, default off).
  for (const handler of allActions) {
    if (
      handler.kind !== 'edit_sign' &&
      handler.kind !== 'use' &&
      handler.kind !== 'break' &&
      handler.kind !== 'plan'
    ) {
      built.actions.register(handler);
    }
  }
  built.actions.register(editSignHandler(options.editSign ?? false));
  built.actions.register(useHandler(options.use ?? false));
  // break and plan follow body_actions.building (BLD-S3a, decision 0218 plumbing; default off).
  built.actions.register(breakHandler(options.building ?? false));
  if (options.building === true) {
    // The origin `here` is the feet, as the floor of the bot's position.
    const feet = () => {
      const p = options.bot.entity?.position;
      return p
        ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
        : { x: 0, y: 0, z: 0 };
    };
    plan = createLaneWiring({
      lifeId: options.lifeId,
      bot: options.bot,
      runtime: built,
      expand: createPlanSource(feet),
      ...(options.planStore === undefined ? {} : { store: options.planStore }),
      ...(options.wallClock === undefined ? {} : { wallClock: options.wallClock }),
      ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    });
  }
  built.actions.register(planHandler(options.building ?? false, plan?.queue ?? null));
  const executor = new IntentExecutor({
    runtime: built,
    ticks: options.ticks,
    currentRevision: options.currentRevision,
    wakeTap: tap,
    // A running intent pauses the plan lane (BLD-14); nothing is held when building is off.
    ...(plan === null ? {} : { foreground: plan.contention }),
    ...(checkpoints === null ? {} : { observer: checkpoints }),
    ...(options.snapshotWindow === undefined ? {} : { snapshotWindow: options.snapshotWindow }),
    ...(options.nearbyAgents === undefined ? {} : { nearbyAgents: options.nearbyAgents }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  // The bot object lives through a death; what the reflexes remember about the old body does not.
  const forgetOldBody = (): void => {
    forgetBurrow(built.view);
    forgetShelterBackoff(built.view);
    resetStuck(built.view);
    resetIdleStuck(built.view);
    forgetThreatEncounter(built.view);
  };
  if (typeof options.bot.on === 'function') options.bot.on('respawn', forgetOldBody);
  // The time since rest is an operator log line on 26.1 only (decision 0225); no reflex or Mind reads it.
  watchRestStat(
    options.bot,
    options.timeScale === undefined ? {} : { timeScale: options.timeScale },
  );
  // Death, not the respawn, ends the previous life's work: a step still running would walk the new body on.
  // The plan queue is cleared with the executor: its lane drops the plan and aborts the cell.
  const deathTarget: DeathTarget = {
    endForDeath: (revision) =>
      Promise.all([executor.endForDeath(revision), plan?.queue.cancel('all')]).then(
        () => undefined,
      ),
  };
  if (typeof options.bot.on === 'function') {
    options.bot.on('death', () => {
      cancelForDeath(deathTarget, options.currentRevision).catch((error: unknown) => {
        console.warn(`death hook failed: ${String(error)}`);
      });
    });
  }
  built.actions.onFinished((action, run) => {
    if (!isAction(action)) return;
    noteActionEnd(built.view);
    // A `mine` counts only when its walk to the block was blocked (never as an arrival).
    const p = options.bot.entity?.position;
    const at = p ? { x: p.x, y: p.y, z: p.z } : undefined;
    if (action.do === 'goto' || (action.do === 'mine' && run.state === 'failed')) {
      const stalled = run.result.detail?.stalled === true;
      noteGoto(
        built.view,
        run.state,
        run.result.reason,
        run.result.message,
        stalled,
        at,
        action.do,
      );
    }
    // An unstick run, the Mind's or a reflex's, is an attempt at its spot too (decision 0336).
    if (action.do === 'unstick') {
      noteWalkOutcome(built.view, 'unstick', run.state, run.result.reason, at);
    }
    // With the reflex off nothing would take the report, so a program must not wait for one.
    // Only a walk the intent's program ran: a plan's own goto is the Mind's to handle.
    if (isReflexEnabled(reflexConfig, 'blocked_path') && executor.ranByProgram(action))
      reportBlockedWalk(built, executor, action, run);
    executor.noteAction(action, run);
  });
  // The seen map is kept only with body_actions.building on (BLD-38d); off, nothing is constructed.
  const seen: SeenWiring | null =
    options.building === true
      ? createSeenWiring({
          bot: options.bot,
          ticks: options.ticks,
          lifeId: options.lifeId,
          ...(options.seen ?? {}),
          ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
        })
      : null;
  return { runtime: built, executor, tap, records, checkpoints, plan, seen };
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
