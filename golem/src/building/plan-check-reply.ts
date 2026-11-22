// The Body's answer to a `plan_check` request (BLD-22b): a dry run of a plan against the Body's pack and
// seen map. It places and breaks nothing. The seen map is read for a boolean per cell: a cell never seen
// counts as unknown and its coordinates never leave this file. The reply is the contract's plan_check
// result, or a refusal (`plan_too_large` over the cell cap, `not_available` when the building flag is off).
import { validateToolInput, validateToolResult } from '@geldar/contract';
import {
  type Cell,
  expandPlan,
  type PlanCell,
  type PlanSpec,
  type PlanStep,
  tallyMaterials,
} from '@geldar/player-core/src/building/index.ts';
import type { SeenMap } from './seen/section.ts';

/** The planning estimate: one tick per cell (the placeholder the MCP tool used before BLD-22b). */
export const PLAN_CHECK_TICKS_PER_CELL = 1;

/** Most cells one dry run expands. A plan over it is refused as `plan_too_large`; no cell past it is expanded. */
export const PLAN_CHECK_CELL_CAP = 8_192;

const MAX_REASON = 120;

/** What a dry run reads from the Body: the seen map, the pack by item name, and the feet cell. */
export interface PlanCheckBody {
  seen: SeenMap;
  pack: () => Record<string, number>;
  feet: () => Cell;
}

/** The part of the Body's bot a dry run reads: its inventory and its position. */
export interface PlanCheckBot {
  inventory: { items(): { name: string; count: number }[] };
  entity?: { position: Cell };
}

/** The dry run as the reply states it (the contract's plan_check result). */
export interface PlanCheckResult {
  cells: number;
  material_needs: Record<string, { need: number; have: number }>;
  unknown_cells: number;
  estimated_ticks: number;
  invalid_steps: { index: number; reason: string }[];
}

/** The reply: the dry run, or a refusal. `invalid_input` is an answer the gateway reads as a failure. */
export type PlanCheckAnswer =
  | PlanCheckResult
  | { error: 'invalid_input' | 'not_available' | 'plan_too_large' };

/** Thrown inside the expansion once the cap is passed; the answer maps it to `plan_too_large`. */
class PlanTooLarge extends Error {}

/**
 * The Mind-link server's `plan_check` option for a Body whose seen map exists (the building flag is on):
 * each request is answered from the map, the bot's pack and its feet cell. A bot with no position is
 * `not_available`, so the gateway fails closed.
 */
export function planCheckFrom(seen: SeenMap, bot: PlanCheckBot): (request: unknown) => unknown {
  return (request) =>
    answerPlanCheck({ seen, pack: () => packOf(bot), feet: () => feetOf(bot) }, request, true);
}

/**
 * Answers a plan_check request. `building` is the shard's body_actions.building flag: off, every request
 * is `not_available` and the map is not read. Never throws.
 */
export function answerPlanCheck(
  body: PlanCheckBody,
  request: unknown,
  building: boolean,
): PlanCheckAnswer {
  if (!building) return { error: 'not_available' };
  if (!validateToolInput('plan_check', request).ok) return { error: 'invalid_input' };
  try {
    const check = dryRun((request as { plan: PlanSpec }).plan, body);
    return validateToolResult('plan_check', check).ok ? check : { error: 'not_available' };
  } catch (error) {
    if (error instanceof PlanTooLarge) return { error: 'plan_too_large' };
    return { error: 'not_available' };
  }
}

/** Counts each step on its own. A step that fails to expand adds nothing and is listed as invalid. */
function dryRun(plan: PlanSpec, body: PlanCheckBody): PlanCheckResult {
  const base = originOf(plan, body.feet());
  const pack = body.pack();
  const invalid: { index: number; reason: string }[] = [];
  const counts = new Map<string, number>();
  let cells = 0;
  let unknown = 0;
  plan.steps.forEach((step, index) => {
    if (namesMissingKey(step, plan)) {
      invalid.push({ index, reason: 'unknown_palette_key' });
      return;
    }
    let stepCells = 0;
    let stepUnknown = 0;
    const visit = (cell: Cell): void => {
      stepCells++;
      if (cells + stepCells > PLAN_CHECK_CELL_CAP) throw new PlanTooLarge('cell cap');
      if (body.seen.read(cell.x, cell.y, cell.z) === undefined) stepUnknown++;
    };
    try {
      const stepTally = tallyMaterials(
        shifted(expandPlan({ palette: plan.palette, steps: [step] }), base, visit),
      );
      cells += stepCells;
      unknown += stepUnknown;
      for (const [pal, n] of Object.entries(stepTally)) counts.set(pal, (counts.get(pal) ?? 0) + n);
    } catch (error) {
      if (error instanceof PlanTooLarge) throw error;
      invalid.push({ index, reason: reasonOf(error) });
    }
  });
  const material_needs: PlanCheckResult['material_needs'] = {};
  for (const [pal, need] of counts) {
    const block = blockOf(plan, pal);
    const prior = material_needs[block]?.need ?? 0;
    material_needs[block] = { need: prior + need, have: pack[block] ?? 0 };
  }
  return {
    cells,
    material_needs,
    unknown_cells: unknown,
    estimated_ticks: cells * PLAN_CHECK_TICKS_PER_CELL,
    invalid_steps: invalid.sort((a, b) => a.index - b.index),
  };
}

/** The offset relative cells are measured from: none, a coordinate, or the feet cell for `here`. */
function originOf(plan: PlanSpec, feet: Cell): Cell {
  const origin = plan.origin;
  if (origin === undefined) return { x: 0, y: 0, z: 0 };
  if (origin === 'here') return feet;
  return origin;
}

/** Shifts each expanded cell by the origin and reports it to `visit`; lazy, so nothing is collected. */
function* shifted(
  cells: Iterable<PlanCell>,
  base: Cell,
  visit: (cell: Cell) => void,
): IterableIterator<PlanCell> {
  for (const cell of cells) {
    const at = { x: cell.x + base.x, y: cell.y + base.y, z: cell.z + base.z };
    visit(at);
    yield { ...at, pal: cell.pal };
  }
}

/** A placing step must name a palette key the plan defines (the expansion does not check that). */
function namesMissingKey(step: PlanStep, plan: PlanSpec): boolean {
  const placing = step.op !== 'break' && step.break !== true;
  return placing && step.pal !== undefined && !Object.hasOwn(plan.palette, step.pal);
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'invalid_step';
  return message.slice(0, MAX_REASON);
}

function blockOf(plan: PlanSpec, pal: string): string {
  return (plan.palette[pal] as { block: string }).block;
}

/** The bot's pack: the count of each item name it carries. */
function packOf(bot: PlanCheckBot): Record<string, number> {
  const pack: Record<string, number> = {};
  for (const stack of bot.inventory.items()) {
    pack[stack.name] = (pack[stack.name] ?? 0) + stack.count;
  }
  return pack;
}

/** The block cell the bot stands in; throws when the bot has no position (the answer refuses). */
function feetOf(bot: PlanCheckBot): Cell {
  const position = bot.entity?.position;
  if (position === undefined) throw new Error('no body position');
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}
