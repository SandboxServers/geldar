// Cell executor (BLD-11). Works one planned cell: reads it live, skips it when it already
// matches or was changed by someone else (ruling 9: skip, never overwrite), otherwise breaks the
// prior block and places the target through the place and break handlers, verifies the result,
// and returns one code. Batch layers (lane, stand, scaffold, hazards) call this per cell.

import { MINE_CELL_MESSAGE } from '../actions/mine-cell.ts';
import type { ActionOutcome } from '../actions/outcome.ts';
import { recordOwnPlacement } from '../actions/own-placements.ts';
import { confirmsPlacement, MESSAGE } from '../actions/place.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import { countMaterials, dropOf, holdsToolKind, type ToolKind, toolFor } from './materials.ts';
import type { HeldBlock } from './scaffold.ts';
import type { Cell } from './stand.ts';

/** The failure codes every cell reports (the shared list of the building plan). */
export const CELL_FAILURES = [
  'done_already',
  'changed',
  'blocked',
  'no_reference',
  'out_of_reach',
  'not_loaded',
  'missing_materials',
  'no_tool',
  'unbreakable',
  'state_unachievable',
  'timeout',
  'refused',
] as const;
export type CellFailure = (typeof CELL_FAILURES)[number];

/** What a cell ends with: a failure code, a success, or the caller's cancel. */
export type CellCode = CellFailure | 'placed' | 'broken' | 'cancelled';

/** One planned cell. `prior` is the block planned to be there first; `target` is the block to leave, or `air` to break it. */
export interface PlanCell {
  at: Cell;
  prior: string;
  target: string;
}

/** What the executor reads about the world and the inventory. Built from the bot, or faked in tests. */
export interface CellEnv {
  /** Block name at the cell, `air` for empty; null when the chunk is not loaded. */
  blockAt(at: Cell): string | null;
  /** Placeable items the agent holds. */
  held(): HeldBlock[];
  /** Names of every item the agent holds (tools included). */
  heldNames(): string[];
}

/** The two handlers the executor drives: the place and the break of BLD-06 to BLD-08. */
export interface CellHandlers {
  place: ActionHandler<'place'>;
  dig: ActionHandler<'break'>;
}

/** Works one planned cell and returns its code. Never throws for a handler's failure. */
export async function doCell(
  ctx: ActionContext,
  cell: PlanCell,
  env: CellEnv,
  handlers: CellHandlers,
): Promise<CellCode> {
  const live = env.blockAt(cell.at);
  if (live === null) return 'not_loaded';
  if (live === cell.target) return 'done_already';
  if (live !== cell.prior) return 'changed';

  const refused = preflight(cell, env);
  if (refused !== null) return refused;

  if (cell.prior !== 'air') {
    const dug = await handlers.dig.run(ctx, { do: 'break', at: cell.at });
    const code = settle(dug, () => (env.blockAt(cell.at) === 'air' ? null : 'blocked'));
    if (code !== null) return code;
  }
  if (cell.target === 'air') return 'broken';

  const placed = await handlers.place.run(ctx, { do: 'place', block: cell.target, at: cell.at });
  const code = settle(placed, () =>
    confirmsPlacement(env.blockAt(cell.at) ?? '', cell.target) ? null : 'blocked',
  );
  if (code !== null) return code;
  recordOwnPlacement(ctx.bot, cell.at, cell.target);
  return 'placed';
}

/**
 * The checks before anything is broken: the target item must be held, or the break must yield it
 * (a replace); a prior block must be breakable with a tool the agent holds. Null when all hold.
 */
function preflight(cell: PlanCell, env: CellEnv): CellFailure | null {
  if (cell.target !== 'air') {
    const yielded = cell.prior === 'air' ? 0 : Number(dropOf(cell.prior) === cell.target);
    if (countMaterials(env.held(), cell.target) + yielded < 1) return 'missing_materials';
  }
  if (cell.prior !== 'air') {
    const tool: ToolKind = toolFor(cell.prior);
    if (!holdsToolKind(env.heldNames(), tool)) return 'no_tool';
  }
  return null;
}

/**
 * Turns a handler's outcome into the cell's code. Returns null when the handler completed and
 * `verify` agrees; a code otherwise. A cancel becomes `cancelled`.
 */
function settle(outcome: ActionOutcome, verify: () => CellFailure | null): CellCode | null {
  if (outcome.status === 'cancelled') return 'cancelled';
  if (outcome.status === 'completed') return verify();
  return codeOf(outcome);
}

/** Maps a handler's failure reason and message to one cell code. Unknown failures are `refused`. */
function codeOf(outcome: Extract<ActionOutcome, { status: 'failed' }>): CellFailure {
  const { reason, message } = outcome;
  if (message === MESSAGE.notLoaded || message === MINE_CELL_MESSAGE.notLoaded) return 'not_loaded';
  switch (reason) {
    case 'out_of_reach':
      return 'out_of_reach';
    case 'missing_materials':
      return 'missing_materials';
    case 'state_unachievable':
      return 'state_unachievable';
    case 'timeout':
      return 'timeout';
    case 'blocked':
      return message === MESSAGE.noReference ? 'no_reference' : 'blocked';
    case 'not_found':
      return 'changed';
    case 'no_effect':
      return 'blocked';
    case 'not_possible':
      return 'unbreakable';
    default:
      return 'refused';
  }
}
