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
import type { CellEnv, CellHandlers } from './cell-do.ts';
import { type Contention, contendFor } from './contention.ts';
import { PlanLane } from './lane.ts';
import { type PlanExpand, PlanQueue } from './queue.ts';

/** The holder name a reflex's tick takes on the lane's contention. */
const REFLEX_HOLDER = 'reflex';

/** What the wiring is built from. */
export interface LaneWiringOptions {
  lifeId: string;
  bot: Bot;
  runtime: BodyRuntime;
  expand: PlanExpand;
}

/** The parts of one Body's plan work. */
export interface LaneWiring {
  queue: PlanQueue;
  lane: PlanLane;
  contention: Contention;
  /** One world tick, after the reflexes: `reflexBusy` holds the lane, else it is released and stepped. */
  onTick(tick: number, reflexBusy: boolean): Promise<void>;
}

/** Builds the queue and the lane of one Body. Nothing runs until `onTick` is called. */
export function createLaneWiring(options: LaneWiringOptions): LaneWiring {
  const { bot, runtime } = options;
  const lane = new PlanLane();
  const contention = contendFor(lane);
  const queue = new PlanQueue({
    lifeId: options.lifeId,
    lane,
    contention,
    expand: options.expand,
  });
  const env = cellEnvOf(bot);
  const handlers = cellHandlersOf(runtime);
  return {
    queue,
    lane,
    contention,
    async onTick(_tick: number, reflexBusy: boolean): Promise<void> {
      if (reflexBusy) await contention.hold(REFLEX_HOLDER);
      else contention.release(REFLEX_HOLDER);
      const ctx: ActionContext = {
        bot,
        signal: new AbortController().signal,
        timeScale: runtime.timeScale,
      };
      await queue.step(ctx, { env, handlers, now: () => runtime.view.tick ?? 0 });
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
    held: () => bot.inventory.items().map((item) => ({ name: item.name, count: item.count })),
    heldNames: () => bot.inventory.items().map((item) => item.name),
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
    try {
      run = await runtime.runAction(action, ctx.signal);
    } catch (error) {
      return cancelled({ error: error instanceof Error ? error.message : String(error) });
    }
    return outcomeOf(run);
  };
  return {
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
