// The Body's answer to a `plan_check` request (BLD-22b): a dry run of a plan against the Body's pack and
// seen map. It places and breaks nothing. The seen map is read for a boolean per cell: a cell never seen
// counts as unknown and its coordinates never leave this file. The reply is the contract's plan_check
// result, or a refusal (`not_available` when the building flag is off, or the walk was superseded).
//
// The dry run has no cell cap (decision 0423). It streams the plan one step at a time and one layer at a
// time (lazyBottomUp, the production order), so only one layer is held. It yields to the event loop after
// each slice of cells, and stops when its signal aborts (a newer plan_check, or the Body ends).
import { validateToolInput, validateToolResult } from '@geldar/contract';
import type { Cell, PlanSpec, PlanStep } from '@geldar/player-core/src/building/index.ts';
import { type LayerObserver, lazyBottomUp } from '@geldar/player-core/src/building/layers.ts';
import type { SeenMap } from './seen/section.ts';
import { COUNT_SLICE } from './wire-expand.ts';

/** The planning estimate: one tick per cell (the placeholder the MCP tool used before BLD-22b). */
export const PLAN_CHECK_TICKS_PER_CELL = 1;

const MAX_REASON = 120;

/** Most invalid steps one reply lists; the rest are dropped (the count of cells is still exact). */
export const MAX_INVALID_STEPS = 256;

/** What a dry run reads from the Body: the seen map, the pack by item name, and the feet cell. */
export interface PlanCheckBody {
  seen: SeenMap;
  pack: () => Record<string, number>;
  feet: () => Cell;
  /** Cells counted between two yields to the event loop; read before each slice. Default COUNT_SLICE. */
  sliceFor?: () => number;
  /** Told each layer as the walk materializes it (a measuring hook; the answer does not use it). */
  layers?: LayerObserver;
  /** Told the walk's progress about every PROGRESS_EVERY_MS while it runs (a chunk on the reply inbox). */
  progress?: (report: PlanCheckProgress) => void;
  /** The clock progress is paced by, in ms; default Date.now. */
  clock?: () => number;
}

/** A progress chunk: the layers the walk has materialized and the cells it has counted so far. */
export interface PlanCheckProgress {
  layers_done: number;
  cells_checked: number;
}

/** How often a running walk reports progress, in ms; the gateway's stall window is longer. */
export const PROGRESS_EVERY_MS = 1_000;

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
export type PlanCheckAnswer = PlanCheckResult | { error: 'invalid_input' | 'not_available' };

/** Thrown inside the walk once its signal aborts; the answer maps it to `not_available`. */
class WalkAborted extends Error {}

/**
 * The Mind-link server's `plan_check` option for a Body whose seen map exists (the building flag is on):
 * each request is answered from the map, the bot's pack and its feet cell. A new request supersedes the
 * walk still running (it aborts, and answers not_available). `lifeSignal` ends every walk when the Body
 * ends. A bot with no position is `not_available`, so the gateway fails closed.
 */
export function planCheckFrom(
  seen: SeenMap,
  bot: PlanCheckBot,
  lifeSignal?: AbortSignal,
): (request: unknown, progress?: (report: PlanCheckProgress) => void) => Promise<unknown> {
  let running: AbortController | null = null;
  return (request, progress) => {
    running?.abort();
    const walk = new AbortController();
    running = walk;
    const signal =
      lifeSignal === undefined ? walk.signal : AbortSignal.any([walk.signal, lifeSignal]);
    return answerPlanCheck(
      {
        seen,
        pack: () => packOf(bot),
        feet: () => feetOf(bot),
        ...(progress === undefined ? {} : { progress }),
      },
      request,
      true,
      signal,
    );
  };
}

/**
 * Answers a plan_check request. `building` is the shard's body_actions.building flag: off, every request
 * is `not_available` and the map is not read. `signal` aborts the walk (the answer is then `not_available`).
 * Never throws.
 */
export async function answerPlanCheck(
  body: PlanCheckBody,
  request: unknown,
  building: boolean,
  signal?: AbortSignal,
): Promise<PlanCheckAnswer> {
  if (!building) return { error: 'not_available' };
  if (!validateToolInput('plan_check', request).ok) return { error: 'invalid_input' };
  try {
    const check = await dryRun((request as { plan: PlanSpec }).plan, body, signal);
    return validateToolResult('plan_check', check).ok ? check : { error: 'not_available' };
  } catch {
    return { error: 'not_available' };
  }
}

/**
 * Counts each step on its own, one layer at a time. A step that fails to expand adds nothing and is
 * listed as invalid. The step's counts are merged only when the step finishes, so a step that fails
 * part way adds no cells.
 */
async function dryRun(
  plan: PlanSpec,
  body: PlanCheckBody,
  signal?: AbortSignal,
): Promise<PlanCheckResult> {
  const base = originOf(plan, body.feet());
  const pack = body.pack();
  const sliceFor = body.sliceFor ?? (() => COUNT_SLICE);
  const invalid: { index: number; reason: string }[] = [];
  const counts = new Map<string, number>();
  let cells = 0;
  let unknown = 0;
  let inSlice = 0;
  let limit = sliceLimit(sliceFor);
  const clock = body.clock ?? Date.now;
  let lastReport = clock();
  let layersDone = 0;
  const layerCount: LayerObserver = {
    onLayer: (y, size) => {
      layersDone++;
      body.layers?.onLayer?.(y, size);
    },
  };
  for (const [index, step] of plan.steps.entries()) {
    if (signal?.aborted) throw new WalkAborted('superseded');
    if (namesMissingKey(step, plan)) {
      invalid.push({ index, reason: 'unknown_palette_key' });
      continue;
    }
    const stepCounts = new Map<string, number>();
    let stepCells = 0;
    let stepUnknown = 0;
    try {
      const layers = lazyBottomUp(
        { palette: plan.palette, steps: [step] } as PlanSpec,
        base,
        layerCount,
      );
      for (const cell of layers) {
        stepCells++;
        if (body.seen.read(cell.x, cell.y, cell.z) === undefined) stepUnknown++;
        if (cell.pal !== null) stepCounts.set(cell.pal, (stepCounts.get(cell.pal) ?? 0) + 1);
        if (++inSlice >= limit) {
          inSlice = 0;
          limit = sliceLimit(sliceFor);
          await pause(signal);
          if (body.progress !== undefined && clock() - lastReport >= PROGRESS_EVERY_MS) {
            lastReport = clock();
            body.progress({ layers_done: layersDone, cells_checked: cells + stepCells });
          }
        }
      }
    } catch (error) {
      if (error instanceof WalkAborted) throw error;
      invalid.push({ index, reason: reasonOf(error) });
      continue;
    }
    cells += stepCells;
    unknown += stepUnknown;
    for (const [pal, n] of stepCounts) counts.set(pal, (counts.get(pal) ?? 0) + n);
  }
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
    invalid_steps: invalid.sort((a, b) => a.index - b.index).slice(0, MAX_INVALID_STEPS),
  };
}

/** Yields to the event loop once, then stops the walk if its signal has aborted. */
async function pause(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (signal?.aborted) throw new WalkAborted('superseded');
}

/** A slice size as a whole number of at least 1; a value that is not a number counts as 1. */
function sliceLimit(sliceFor: () => number): number {
  const n = sliceFor();
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

/** The offset relative cells are measured from: none, a coordinate, or the feet cell for `here`. */
function originOf(plan: PlanSpec, feet: Cell): Cell {
  const origin = plan.origin;
  if (origin === undefined) return { x: 0, y: 0, z: 0 };
  if (origin === 'here') return feet;
  return origin;
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
