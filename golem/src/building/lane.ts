// The plan lane (BLD-13). Steps a plan's cells a slice at a time: the Body loop calls `step`, and the
// lane holds no timer of its own. A reflex pauses it (the in-flight cell is aborted and re-read on
// resume, so a cell is never placed twice: `done_already`). A death drops the plan. One plan at a
// time; a second `start` is refused (BLD-14 adds the queue).
import type { ActionContext } from '../actions/registry.ts';
import {
  type CellCode,
  type CellEnv,
  type CellHandlers,
  doCell,
  type PlanCell,
} from './cell-do.ts';
import type { LaneStateName } from './lane-state.ts';
import type { PlanCheckpointState, SkippedCell } from './plan-checkpoint.ts';

/** World ticks one `step` may run before it returns; the Body loop calls again on a later tick. */
export const SLICE_TICKS = 4;

/** A plan the lane runs: its cells in order, the chunk count it is stored under, and the cursor to start from. */
export interface LanePlan {
  lifeId: string;
  planId: string;
  chunks: number;
  cells: readonly PlanCell[];
  /** Index of the next cell to run; a restart passes the checkpoint's cursor. Default 0. */
  cursor?: number;
}

/** What `step` reads from the world: the cell env, the cell handlers and the world tick. */
export interface LaneDeps {
  env: CellEnv;
  handlers: CellHandlers;
  /** The world tick now. A slice stops once it has run `SLICE_TICKS` ticks. */
  now: () => number;
}

/** Codes that leave the cell right: the cursor moves on. Every other code is skipped and recorded. */
const DONE: ReadonlySet<CellCode> = new Set(['placed', 'broken', 'done_already']);

/**
 * The plan lane. Retry rule: no cell is retried. A skipped cell (any code but `missing_materials`
 * and `cancelled`) is recorded and the cursor moves on. `missing_materials` holds the cursor and
 * the lane waits in `waiting_materials`, re-reading that cell on each slice, with no cap: it ends
 * only when the items arrive, the plan is dropped or the Body dies.
 */
export class PlanLane {
  state: LaneStateName = 'idle';
  private plan: LanePlan | null = null;
  private cursor = 0;
  private counts: Record<string, number> = {};
  private skipped: SkippedCell[] = [];
  private inFlight: AbortController | null = null;
  private gate: Promise<void> | null = null;

  /** Starts a plan from its cursor. Refused (false) while another plan is active. */
  start(plan: LanePlan): boolean {
    if (this.plan !== null) return false;
    this.plan = plan;
    this.cursor = plan.cursor ?? 0;
    this.counts = {};
    this.skipped = [];
    this.state = 'running';
    return true;
  }

  /** Runs cells from the cursor until this slice's ticks are spent or the lane stops for a reason. */
  async step(ctx: ActionContext, deps: LaneDeps): Promise<void> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.gate = gate;
    try {
      await this.slice(ctx, deps);
    } finally {
      open();
      if (this.gate === gate) this.gate = null;
    }
  }

  /**
   * A reflex takes the lane: the in-flight cell is aborted and the lane stays `paused` until
   * `resume`. Resolves once the aborted cell has ended. A no-op with no plan.
   */
  async pauseForReflex(): Promise<void> {
    if (this.plan === null) return;
    const gate = this.gate;
    this.state = 'paused';
    this.inFlight?.abort();
    await gate;
  }

  /** Ends a reflex pause: the next `step` runs from the cursor. */
  resume(): void {
    if (this.state === 'paused' && this.plan !== null) this.state = 'running';
  }

  /**
   * The Body died: the plan is dropped for this life, the in-flight cell is aborted and nothing
   * resumes. Matches the death target of `death-cancel.ts`.
   */
  async endForDeath(_revision: number): Promise<void> {
    const gate = this.gate;
    this.plan = null;
    this.state = 'idle';
    this.cursor = 0;
    this.counts = {};
    this.skipped = [];
    this.inFlight?.abort();
    await gate;
  }

  /** Counts by code and skipped cells of the current or last plan; kept after the plan ends. */
  progress(): { counts: Record<string, number>; skipped: SkippedCell[] } {
    return { counts: { ...this.counts }, skipped: [...this.skipped] };
  }

  /** The state a checkpoint saves (cursor, counts, skipped cells); null when no plan runs. */
  checkpointState(): PlanCheckpointState | null {
    if (this.plan === null) return null;
    return {
      life_id: this.plan.lifeId,
      plan_id: this.plan.planId,
      chunks: this.plan.chunks,
      cursor: this.cursor,
      counts: { ...this.counts },
      skipped: [...this.skipped],
    };
  }

  private runnable(): boolean {
    return this.plan !== null && (this.state === 'running' || this.state === 'waiting_materials');
  }

  private async slice(ctx: ActionContext, deps: LaneDeps): Promise<void> {
    const began = deps.now();
    while (this.runnable() && deps.now() - began < SLICE_TICKS) {
      if (ctx.signal.aborted) return;
      const plan = this.plan;
      if (plan === null) return;
      const cell = plan.cells[this.cursor];
      if (cell === undefined) {
        this.plan = null;
        this.state = 'idle';
        return;
      }
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      ctx.signal.addEventListener('abort', stop, { once: true });
      this.inFlight = ctl;
      let code: CellCode;
      try {
        code = await doCell({ ...ctx, signal: ctl.signal }, cell, deps.env, deps.handlers);
      } finally {
        ctx.signal.removeEventListener('abort', stop);
        this.inFlight = null;
      }
      // A pause, a death or a runtime stop ended the cell: the cursor stays so the cell is re-read.
      if (!this.runnable() || code === 'cancelled') return;
      if (code === 'missing_materials') {
        this.state = 'waiting_materials';
        return;
      }
      this.count(code);
      if (!DONE.has(code)) {
        this.skipped.push({ at: [cell.at.x, cell.at.y, cell.at.z], code });
      }
      this.cursor++;
      this.state = 'running';
      if (this.cursor >= plan.cells.length) {
        this.plan = null;
        this.state = 'idle';
        return;
      }
    }
  }

  private count(code: CellCode): void {
    this.counts[code] = (this.counts[code] ?? 0) + 1;
  }
}

/** Creates the lane while body_actions.building is on; null when it is off (nothing is registered). */
export function createPlanLane(enabled: boolean): PlanLane | null {
  return enabled ? new PlanLane() : null;
}

/** Resumes a saved plan after a restart. Stub: no-op until BLD-14 wires restart.ts. */
export function resumePlanLane(): void {
  // BLD-14 fills this in.
}
