import { validateToolInput, validateToolResult } from '@geldar/contract';
import {
  type Cell,
  expandPlan,
  type PlanCell,
  type PlanSpec,
  type PlanStep,
  tallyMaterials,
} from '@geldar/player-core/src/building/index.ts';
import type { ToolCall } from './look.ts';

/** The planning estimate: one tick per cell. The lane's own timing is not in this tool's reach. */
export const PLAN_CHECK_TICKS_PER_CELL = 1;

/** The closed failures a `plan_check` call can end with; the world turns each into a tool error. */
export type PlanCheckError = 'invalid_input' | 'session_closed' | 'body_unavailable';

/** The life's state the dry run reads: the pack by item name, the feet cell, and the seen map. */
export interface PlanCheckView {
  pack: Record<string, number>;
  feet: Cell;
  /** True when the life has seen the block at this cell. Only a boolean leaves this tool. */
  seen: (cell: Cell) => boolean;
}

export interface PlanCheckDeps {
  /** The life's read; a throw is `body_unavailable`. */
  read: (lifeId: string) => Promise<PlanCheckView>;
  /** False once the session has closed; a closed session refuses without reading the Body. */
  isOpen: () => boolean;
}

/** The dry run as the reply states it. Counts only: no coordinates of unseen cells. */
export interface PlanCheckResult {
  cells: number;
  material_needs: Record<string, { need: number; have: number }>;
  unknown_cells: number;
  estimated_ticks: number;
  invalid_steps: { index: number; reason: string }[];
}

/** Either the dry run, or one closed failure. A failure is data here; the world throws it as a ToolError. */
export type PlanCheckOutcome = { check: PlanCheckResult } | { error: PlanCheckError };

const MAX_REASON = 120;

/**
 * `plan_check`: a dry run of a building plan against the pack and the seen map. It places and breaks
 * nothing. Cells are expanded with the lane's library (`expandPlan`, `tallyMaterials`) and counted
 * lazily. A closed session and a bad input never reach the Body. Never throws.
 */
export async function planCheckTool(
  deps: PlanCheckDeps,
  call: ToolCall,
  input: unknown,
): Promise<PlanCheckOutcome> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  if (!validateToolInput('plan_check', input).ok) return { error: 'invalid_input' };
  const plan = (input as { plan: PlanSpec }).plan;
  let view: PlanCheckView;
  try {
    view = await deps.read(call.lifeId);
  } catch {
    return { error: 'body_unavailable' };
  }
  try {
    const check = dryRun(plan, view);
    if (!validateToolResult('plan_check', check).ok) return { error: 'body_unavailable' };
    return { check };
  } catch {
    return { error: 'body_unavailable' };
  }
}

/** Counts each step on its own. A step that fails to expand adds nothing and is listed as invalid. */
function dryRun(plan: PlanSpec, view: PlanCheckView): PlanCheckResult {
  const base = originOf(plan, view.feet);
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
    try {
      const stepTally = tallyMaterials(
        shifted(expandPlan({ palette: plan.palette, steps: [step] }), base, (cell) => {
          stepCells++;
          if (!seenOf(view, cell)) stepUnknown++;
        }),
      );
      cells += stepCells;
      unknown += stepUnknown;
      for (const [pal, n] of Object.entries(stepTally)) counts.set(pal, (counts.get(pal) ?? 0) + n);
    } catch (error) {
      // A seen map that fails is the Body's failure, not a bad step: it ends the whole call.
      if (error instanceof SeenMapDown) throw error;
      invalid.push({ index, reason: reasonOf(error) });
    }
  });
  const material_needs: PlanCheckResult['material_needs'] = {};
  for (const [pal, need] of counts) {
    const block = blockOf(plan, pal);
    const prior = material_needs[block]?.need ?? 0;
    material_needs[block] = { need: prior + need, have: view.pack[block] ?? 0 };
  }
  return {
    cells,
    material_needs,
    unknown_cells: unknown,
    estimated_ticks: cells * PLAN_CHECK_TICKS_PER_CELL,
    invalid_steps: invalid.sort((a, b) => a.index - b.index),
  };
}

/** Thrown when the seen map fails, so the step loop does not mistake the Body failure for a bad step. */
class SeenMapDown extends Error {}

function seenOf(view: PlanCheckView, cell: Cell): boolean {
  try {
    return view.seen(cell);
  } catch {
    throw new SeenMapDown('seen map down');
  }
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
