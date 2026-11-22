// Stand, scaffold and hazard choices for one plan cell (BLD-09, BLD-10), wired into the cell
// executor (phase1/b8-wire). The lane hands its handlers a `stand` port only when body_actions.building
// is on (wire-lane); with no port the cell runs as doCell alone. The solver picks the cell to stand
// on, the agent walks there with goto, and when no stand exists it places survival scaffold it holds
// and removes the scaffold cells that sit on the plan. Adapted at the call site: the solver is not changed.

import type { ActionOutcome } from '../actions/outcome.ts';
import { recordOwnPlacement } from '../actions/own-placements.ts';
import { confirmsPlacement } from '../actions/place.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import { parseBlockRef } from './block-ref.ts';
import {
  type CellCode,
  type CellEnv,
  type CellHandlers,
  doCell,
  type PlanCell,
} from './cell-do.ts';
import { type HazardWorld, hazardAt } from './hazards.ts';
import type { HeldBlock } from './scaffold.ts';
import { scaffoldFor } from './scaffold.ts';
import { type Cell, type StandResult, type StandWorld, standFor } from './stand.ts';

/** What the stand path reads of the world: the bot's feet cell and the block reader. */
export interface StandPort {
  /** The bot's feet cell now. */
  feet(): Cell;
  /** Reads the block at a cell for the solver; null when the chunk is not loaded. */
  world: StandWorld;
}

/** How many stand cells the hazard filter may skip before the batch defers to scaffold. */
const MAX_HAZARD_SKIPS = 8;

function keyOf(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Hazard advice for a stand cell: lava or source water on a face, or falling sand in or above it. */
function hazardous(cell: Cell, port: StandPort, held: HeldBlock[]): boolean {
  const world: HazardWorld = { blockAt: (c) => port.world(c.x, c.y, c.z)?.name ?? 'air' };
  const advice = hazardAt(cell, world, held);
  return advice.falling || advice.fluid !== null;
}

/** The world with the given cells read as solid: the solver then rejects them as a stand. */
function withSolid(world: StandWorld, cells: ReadonlySet<string>): StandWorld {
  return (x, y, z) =>
    cells.has(`${x},${y},${z}`) ? { name: 'stone', boundingBox: 'block' } : world(x, y, z);
}

/**
 * The stand for one target: the solver's answer, with a stand next to lava or source water, or
 * on falling sand, skipped for the next best one. `none` when every candidate is skipped.
 */
export function pickStand(target: Cell, port: StandPort, held: HeldBlock[]): StandResult {
  const feet = port.feet();
  const skipped = new Set<string>();
  for (let n = 0; n <= MAX_HAZARD_SKIPS; n++) {
    const world = skipped.size === 0 ? port.world : withSolid(port.world, skipped);
    const found = standFor([target], world, feet);
    if (found === 'none' || !hazardous(found, port, held)) return found;
    skipped.add(keyOf(found));
  }
  return 'none';
}

/** Works one planned cell through the stand path. Without a `stand` port this is doCell alone. */
export async function doCellAt(
  ctx: ActionContext,
  cell: PlanCell,
  env: CellEnv,
  handlers: CellHandlers,
  planCells: readonly PlanCell[],
): Promise<CellCode> {
  const port = handlers.stand;
  if (port === undefined) return doCell(ctx, cell, env, handlers);
  // A cell that is done, changed or not loaded needs no walk: doCell answers it from the live world.
  const live = env.blockAt(cell.at);
  const prior = cell.prior ?? live;
  if (live === null || live !== prior || live === parseBlockRef(cell.target).name) {
    return doCell(ctx, cell, env, handlers);
  }
  const stand = pickStand(cell.at, port, env.held());
  if (stand === 'none') return withScaffold(ctx, cell, env, handlers, port, planCells);
  if (!sameCell(stand, port.feet())) {
    const walked = await walkTo(ctx, handlers.goto, stand);
    if (walked !== null) return walked;
  }
  return doCell(ctx, cell, env, handlers);
}

/** Walks to the stand cell. Null when the agent arrived; a code when it did not. */
async function walkTo(
  ctx: ActionContext,
  goto: ActionHandler<'goto'> | undefined,
  stand: Cell,
): Promise<CellCode | null> {
  if (goto === undefined) return 'out_of_reach';
  const outcome = await goto.run(ctx, {
    do: 'goto',
    target: { x: stand.x, y: stand.y, z: stand.z },
  });
  if (outcome.status === 'completed') return null;
  return outcome.status === 'cancelled' ? 'cancelled' : 'out_of_reach';
}

/**
 * No stand: pillar or bridge with the agent's own cheapest block, work the cell, then remove the
 * scaffold cells that sit on a plan cell. Nothing is placed without the block in hand.
 */
async function withScaffold(
  ctx: ActionContext,
  cell: PlanCell,
  env: CellEnv,
  handlers: CellHandlers,
  port: StandPort,
  planCells: readonly PlanCell[],
): Promise<CellCode> {
  const sc = scaffoldFor({
    target: cell.at,
    at: port.feet(),
    stand: 'none',
    held: env.held(),
    plan: planCells.map((p) => p.at),
    solid: (c) => port.world(c.x, c.y, c.z)?.boundingBox === 'block',
  });
  if (sc.kind === 'missing_materials') return 'missing_materials';
  if (sc.kind !== 'scaffold') return doCell(ctx, cell, env, handlers);
  for (const at of sc.place) {
    const placed = await handlers.place.run(ctx, { do: 'place', block: sc.block, at });
    const failed = failedCode(placed, () => confirmsPlacement(env.blockAt(at) ?? '', sc.block));
    if (failed !== null) return failed;
    recordOwnPlacement(ctx.bot, at, sc.block);
  }
  const code = await doCell(ctx, cell, env, handlers);
  for (const at of [...sc.remove].reverse()) {
    await handlers.dig.run(ctx, { do: 'break', at });
  }
  return code;
}

/** A scaffold placement's code when it did not land; null when it did. */
function failedCode(outcome: ActionOutcome, landed: () => boolean): CellCode | null {
  if (outcome.status === 'cancelled') return 'cancelled';
  if (outcome.status !== 'completed') return 'blocked';
  return landed() ? null : 'blocked';
}
