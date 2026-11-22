// plan_progress payloads, the bounded sentence for `wait`, and the plan's two wakes (BLD-16).
// Counts only: a payload never carries a cell position, a block or a sample of the seen map.
import type { PlanProgressPayload } from '@geldar/contract';
import { PLAN_WAKE_REASON } from './names.ts';

/** A plan_progress event goes out after this many cells... */
export const PROGRESS_EVERY_CELLS = 25;
/** ...or after this many milliseconds, whichever comes first. */
export const PROGRESS_EVERY_MS = 30_000;
/** The most characters the `wait` sentence holds. */
export const PROGRESS_SENTENCE_MAX = 240;

/** Cell outcomes that count as done; any other counted code is a skipped cell. */
const DONE_CODES: ReadonlySet<string> = new Set(['placed', 'broken', 'done_already']);

export type PlanPhase = PlanProgressPayload['phase'];
export type PlanNeed = NonNullable<PlanProgressPayload['next_need']>;

/** What the lane reports at one moment: its counts by code, its phase and the item it waits for. */
export interface ProgressInput {
  planId: PlanProgressPayload['plan_id'];
  total: number;
  counts: Readonly<Record<string, number>>;
  phase: PlanPhase;
  nextNeed?: PlanNeed | null;
}

/** Builds the plan_progress payload. `done` is every counted cell; skipped cells are the rest. */
export function buildProgressPayload(input: ProgressInput): PlanProgressPayload {
  const skipped: Record<string, number> = {};
  let done = 0;
  for (const [code, count] of Object.entries(input.counts)) {
    if (count <= 0) continue;
    done += count;
    if (!DONE_CODES.has(code)) skipped[code] = count;
  }
  const payload: PlanProgressPayload = {
    plan_id: input.planId,
    total: input.total,
    done,
    placed: input.counts.placed ?? 0,
    broken: input.counts.broken ?? 0,
    skipped_by_code: skipped as PlanProgressPayload['skipped_by_code'],
    phase: input.phase,
  };
  if (input.nextNeed)
    payload.next_need = { block: input.nextNeed.block, count: input.nextNeed.count };
  return payload;
}

/** True when a progress event is due: 25 cells since the last one, or 30 seconds. */
export function progressDue(cellsSinceLast: number, msSinceLast: number): boolean {
  return cellsSinceLast >= PROGRESS_EVERY_CELLS || msSinceLast >= PROGRESS_EVERY_MS;
}

/** The short sentence the `wait` reply and the status block show. Names no owner and no unseen block. */
export function progressSentence(payload: PlanProgressPayload): string {
  const skipped = Object.values(payload.skipped_by_code).reduce<number>(
    (sum, count) => sum + (typeof count === 'number' ? count : 0),
    0,
  );
  let text = `Plan ${payload.plan_id}: ${payload.done} of ${payload.total} cells done, ${payload.placed} placed, ${payload.broken} broken, ${skipped} skipped; ${payload.phase}.`;
  if (payload.next_need) {
    text += ` Waiting for ${payload.next_need.count} ${payload.next_need.block}.`;
  }
  if (text.length > PROGRESS_SENTENCE_MAX) {
    text = `${text.slice(0, PROGRESS_SENTENCE_MAX - 3)}...`;
  }
  return text;
}

/** A wake the plan raises. The reason is a name from names.ts or the contract's `goal_completed`. */
export interface PlanWake {
  reason: typeof PLAN_WAKE_REASON | 'goal_completed';
  detail: string;
}

/** The text of the materials wake: the count short and the item, for the Mind and the log. */
export function materialsWakeText(block: string, have: number, need: number): string {
  const missing = Math.max(0, need - have);
  return `Build stopped: missing ${missing} ${block} (have ${have}, need ${need}). The plan waits until they arrive or it is cancelled.`;
}

/**
 * One materials wait. The Mind is woken once per wait, not once per slice: `waiting` returns the
 * wake the first time and null after; `resumed` ends the wait so the next shortage wakes again.
 */
export class MaterialsWait {
  private woke = false;

  waiting(block: string, have: number, need: number): PlanWake | null {
    if (this.woke) return null;
    this.woke = true;
    return { reason: PLAN_WAKE_REASON, detail: materialsWakeText(block, have, need) };
  }

  resumed(): void {
    this.woke = false;
  }
}

/** The wake a completed plan raises: once, with the counts in the text. */
export function completedWake(payload: PlanProgressPayload): PlanWake {
  return { reason: 'goal_completed', detail: progressSentence(payload) };
}
