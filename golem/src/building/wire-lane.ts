// Wires the plan queue and lane into one Body (BLD-38b). The lane's cells run through the Body's own
// action runtime, so a cell takes the one action slot like any other action: a Mind action or a
// reflex that holds the slot makes the cell wait, never run beside it. The Body's tick hook calls
// `onTick` once per world tick, after the reflexes: a reflex that ran holds the lane for that tick,
// and the queue steps the lane otherwise.
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, failed } from '../actions/outcome.ts';
import type { ActionContext, ActionRun } from '../actions/registry.ts';
import type { BodyRuntime } from '../body/runtime.ts';
import type { GolemMetrics } from '../metrics.ts';
import type { CellCode, CellEnv, CellHandlers } from './cell-do.ts';
import type { StandPort } from './cell-stand.ts';
import { type Contention, contendFor } from './contention.ts';
import { PlanLane } from './lane.ts';
import { PlanProgressEmitter } from './progress-emitter.ts';
import { type PlanBody, type PlanExpand, PlanQueue, type PlanQueueStore } from './queue.ts';
import { TickThrottle } from './throttle.ts';
import { TpsEstimator, type WallClock } from './tps-estimate.ts';
import { countSliceFor } from './wire-expand.ts';

/** The holder name a reflex's tick takes on the lane's contention. */
const REFLEX_HOLDER = 'reflex';

/** What the wiring is built from. */
export interface LaneWiringOptions {
  lifeId: string;
  bot: Bot;
  runtime: BodyRuntime;
  expand: PlanExpand;
  /** Resolves a body's origin before it is stored (queue.ts `pin`); default: as given. */
  pin?: (body: PlanBody) => PlanBody;
  /** Persists queued plans and progress (wire-plan-store); left out, in memory only. */
  store?: PlanQueueStore;
  /** Wall-clock ms for the TPS estimate and the progress cadence; default Date.now. */
  wallClock?: WallClock;
  /** The Body's metrics (metrics.ts): plan cells, throttle waits, queue depth and plan seconds. Absent: none kept. */
  metrics?: GolemMetrics;
}

/** The parts of one Body's plan work. */
export interface LaneWiring {
  queue: PlanQueue;
  lane: PlanLane;
  contention: Contention;
  /** The Body-side TPS estimate, from this Body's own tick times (tps-estimate.ts); undefined until measured. */
  tps: TpsEstimator;
  /** One world tick, after the reflexes: `reflexBusy` holds the lane, else it is released and stepped. */
  onTick(tick: number, reflexBusy: boolean): Promise<void>;
}

/** Builds the queue and the lane of one Body. Nothing runs until `onTick` is called. */
export function createLaneWiring(options: LaneWiringOptions): LaneWiring {
  const { bot, runtime } = options;
  const lane = new PlanLane();
  const contention = contendFor(lane);
  const clock: WallClock = options.wallClock ?? (() => Date.now());
  const tps = new TpsEstimator(clock);
  const queue = new PlanQueue({
    lifeId: options.lifeId,
    lane,
    contention,
    expand: options.expand,
    ...(options.pin === undefined ? {} : { pin: options.pin }),
    ...(options.store === undefined ? {} : { store: options.store }),
    // The add-time count yields on the same TPS reading the lane's throttle uses (throttle.ts).
    sliceFor: () => countSliceFor(tps.tps()),
  });
  const env = cellEnvOf(bot);
  // The stand path (cell-stand.ts) is part of the cell executor only here, where the building flag is on.
  const handlers: CellHandlers = { ...cellHandlersOf(runtime), stand: standPortOf(bot) };
  // The throttle asks before each cell, in world ticks, with the Body's own TPS estimate (throttle.ts).
  const throttle = new TickThrottle(() => tps.tps());
  const metrics = options.metrics;
  // A wait is a verdict other than `go`: one per world tick the cell is held (`tps` is a paused lane).
  const beforeCell = (now: number) => {
    const verdict = throttle.before(now);
    if (verdict !== 'go') metrics?.planThrottleWait(verdict === 'tps');
    return verdict;
  };
  const onCell = (code: CellCode) => metrics?.planCell(code);
  // Plan seconds: the wall time between two ticks on which a plan is still open (not idle, completed or failed).
  let lastAt: number | null = null;
  // The plan's progress events and wakes (progress-emitter.ts) go through the Body's record sink.
  const progress = new PlanProgressEmitter(runtime.sink, clock);
  return {
    queue,
    lane,
    contention,
    tps,
    async onTick(tick: number, reflexBusy: boolean): Promise<void> {
      tps.onTick();
      if (reflexBusy) await contention.hold(REFLEX_HOLDER);
      else contention.release(REFLEX_HOLDER);
      const ctx: ActionContext = {
        bot,
        signal: new AbortController().signal,
        timeScale: runtime.timeScale,
      };
      try {
        await queue.step(ctx, {
          env,
          handlers,
          now: () => runtime.view.tick ?? 0,
          beforeCell,
          onCell,
        });
      } catch (error) {
        // An unexpected throw fails the plan: its `failed` phase goes out once, then the error is rethrown.
        lane.fail();
        progress.observe(lane.snapshot(), tick);
        throw error;
      }
      if (metrics !== undefined) {
        const at = clock();
        const snap = lane.snapshot();
        const open = snap !== null && !['idle', 'completed', 'failed'].includes(snap.phase);
        if (open && lastAt !== null) metrics.planSeconds((at - lastAt) / 1000);
        lastAt = open ? at : null;
        metrics.planQueueDepth(queue.depth());
      }
      progress.observe(lane.snapshot(), tick);
      progress.observeShortfall(lane.materialsShortfall(), tick);
    },
  };
}

/** What the cell executor reads about the world and the inventory, from the live bot. */
export function cellEnvOf(bot: Bot): CellEnv {
  return {
    blockAt: (at) => {
      const block = bot.blockAt(new Vec3(at.x, at.y, at.z));
      return block === null ? null : block.name;
    },
    propsAt: (at) => {
      const block = bot.blockAt(new Vec3(at.x, at.y, at.z)) as {
        getProperties?: () => Record<string, unknown>;
      } | null;
      if (block === null) return null;
      const props = block.getProperties?.() ?? {};
      return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, String(value)]));
    },
    held: () => bot.inventory.items().map((item) => ({ name: item.name, count: item.count })),
    heldNames: () => bot.inventory.items().map((item) => item.name),
  };
}

/** The bot's feet cell and the block reader the stand solver needs (cell-stand.ts), from the live bot. */
export function standPortOf(bot: Bot): StandPort {
  return {
    feet: () => {
      const p = bot.entity.position;
      return { x: Math.floor(p.x), y: Math.floor(p.y + 1e-3), z: Math.floor(p.z) };
    },
    world: (x, y, z) => {
      const block = bot.blockAt(new Vec3(x, y, z));
      return block === null ? null : { name: block.name, boundingBox: block.boundingBox };
    },
  };
}

/**
 * The place and break handlers the cells drive: each one runs through the runtime, so it takes the
 * action slot. A busy slot or a stopping runtime ends the cell as `cancelled`: the cursor stays and
 * the cell is re-read on a later slice.
 */
export function cellHandlersOf(runtime: BodyRuntime): CellHandlers {
  const runCell = async (ctx: ActionContext, action: unknown): Promise<ActionOutcome> => {
    let run: ActionRun;
    // A place that asks for a block state hands it to the runtime, as a program's place does.
    const opts = ctx.placeState === undefined ? {} : { placeState: ctx.placeState };
    try {
      run = await runtime.runAction(action, ctx.signal, opts);
    } catch (error) {
      return cancelled({ error: error instanceof Error ? error.message : String(error) });
    }
    return outcomeOf(run);
  };
  return {
    goto: {
      kind: 'goto',
      timeoutMs: runtime.actions.get('goto')?.timeoutMs ?? 0,
      run: (ctx, action) => runCell(ctx, action),
    },
    place: {
      kind: 'place',
      timeoutMs: runtime.actions.get('place')?.timeoutMs ?? 0,
      run: (ctx, action) => runCell(ctx, action),
    },
    dig: {
      kind: 'break',
      timeoutMs: runtime.actions.get('break')?.timeoutMs ?? 0,
      run: (ctx, action) => runCell(ctx, action),
    },
  };
}

/** The handler outcome a finished run stands for (the executor reads its status, reason and message). */
function outcomeOf(run: ActionRun): ActionOutcome {
  const result = run.result;
  if (result.status === 'completed') return completed(result.detail);
  if (result.status === 'cancelled') return cancelled(result.detail);
  return failed(result.reason ?? 'not_possible', result.message ?? '', result.detail);
}
