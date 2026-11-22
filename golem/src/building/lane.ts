// The plan lane (BLD-13). Steps a plan's cells a slice at a time: the Body loop calls `step`, and the
// lane holds no timer of its own. A reflex pauses it (the in-flight cell is aborted and re-read on
// resume, so a cell is never placed twice: `done_already`). A death drops the plan. One plan at a
// time; a second `start` is refused (BLD-14 adds the queue).
import type { ActionContext } from '../actions/registry.ts';
import { parseBlockRef } from './block-ref.ts';
import type { CellCode, CellEnv, CellHandlers } from './cell-do.ts';
import { type CellSource, forEachCellSliced, type YieldLoop, yieldToLoop } from './cell-source.ts';
import { doCellAt } from './cell-stand.ts';
import type { LaneStateName } from './lane-state.ts';
import { LayerKeys } from './layer-keys.ts';
import { countMaterials } from './materials.ts';
import type { PlanCheckpointState, SkippedCell } from './plan-checkpoint.ts';
import type { Cell } from './stand.ts';
import type { ThrottleVerdict } from './throttle.ts';
import { COUNT_SLICE } from './wire-expand.ts';

/** World ticks one `step` may run before it returns; the Body loop calls again on a later tick. */
export const SLICE_TICKS = 4;

/** What the lane reports for progress: the plan, its phase (`completed` or `failed` once it ended) and counts. */
export interface LaneSnapshot {
  planId: string;
  total: number;
  phase: LaneStateName | 'completed' | 'failed';
  counts: Record<string, number>;
}

/** The item a materials wait is for: the block, how many are held and how many this cell needs. */
export interface MaterialsShortfall {
  block: string;
  have: number;
  need: number;
}

/**
 * A plan the lane runs: its cells in order (read from `source` by index), the exact cell count
 * `total` (from the streaming count at add time), the chunk count it is stored under, and the cursor
 * to start from.
 */
export interface LanePlan {
  lifeId: string;
  planId: string;
  chunks: number;
  source: CellSource;
  /**
   * A factory for a fresh source of the same cells. The stand path asks which cells sit on a layer
   * (scaffold removal), which reads a fresh source once per layer; without it no scaffold is removed.
   */
  fresh?: () => CellSource;
  total: number;
  /** Index of the next cell to run; a restart passes the checkpoint's cursor. Default 0. */
  cursor?: number;
}

/** What `step` reads from the world: the cell env, the cell handlers and the world tick. */
export interface LaneDeps {
  env: CellEnv;
  handlers: CellHandlers;
  /** The world tick now. A slice stops once it has run `SLICE_TICKS` ticks. */
  now: () => number;
  /**
   * Asked before each cell with the world tick (the TPS throttle, wire-lane). `go` runs the cell;
   * `gap` and `tps` end this slice without a cell (`tps` sets phase waiting_tps) and the lane asks
   * again on a later tick. A throw cancels the cell: the cursor stays and the lane keeps running.
   */
  beforeCell?: (now: number) => ThrottleVerdict;
  /** Told each cell's code once it is counted (the plan cell metric, wire-lane). */
  onCell?: (code: CellCode) => void;
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
  /** The plan last started (kept after it ends, for the completed progress event). */
  private last: { planId: string; total: number } | null = null;
  private completed = false;
  private failed = false;
  /** Set while the cursor waits on missing materials; cleared when the cell is counted or the plan ends. */
  private shortfall: MaterialsShortfall | null = null;
  /** The plan cells per y layer for scaffold removal (see `removalsFor`); cleared per plan start and end. */
  private readonly layers = new LayerKeys();
  /** Cells of the current plan read forward so far, up to the cursor (the resume fast-forward, see `prime`). */
  private primed = 0;

  private readonly yieldLoop: YieldLoop;

  constructor(yieldLoop: YieldLoop = yieldToLoop) {
    this.yieldLoop = yieldLoop;
  }

  /**
   * Starts a plan from its cursor, with the counts and skipped cells a checkpoint saved (empty for
   * a new plan). Refused (false) while another plan is active.
   */
  start(
    plan: LanePlan,
    saved?: { counts: Record<string, number>; skipped: SkippedCell[] },
  ): boolean {
    if (this.plan !== null) return false;
    this.plan = plan;
    this.cursor = plan.cursor ?? 0;
    this.counts = { ...(saved?.counts ?? {}) };
    this.skipped = [...(saved?.skipped ?? [])];
    this.state = 'running';
    this.last = { planId: plan.planId, total: plan.total };
    this.completed = false;
    this.failed = false;
    this.shortfall = null;
    this.primed = 0;
    this.layers.reset();
    return true;
  }

  /** The plan's progress view for a progress event; null before any plan. */
  snapshot(): LaneSnapshot | null {
    if (this.last === null) return null;
    const phase = this.failed ? 'failed' : this.completed ? 'completed' : this.state;
    return { ...this.last, phase, counts: { ...this.counts } };
  }

  /**
   * The item the plan waits for while its cursor is held on missing materials; null otherwise
   * (no plan, no wait, or the wait ended). The wake of a materials wait reads it (progress-emitter.ts).
   */
  materialsShortfall(): MaterialsShortfall | null {
    if (this.plan === null || this.shortfall === null) return null;
    return { ...this.shortfall };
  }

  /**
   * The plan ended in failure: it is dropped for this life like a death does, and its snapshot reads
   * phase `failed` for one progress event. A no-op with no plan.
   */
  fail(): void {
    if (this.plan === null) return;
    this.plan = null;
    this.state = 'idle';
    this.failed = true;
    this.shortfall = null;
    this.primed = 0;
    this.layers.reset();
    this.inFlight?.abort();
  }

  /** Runs cells from the cursor until this slice's ticks are spent or the lane stops for a reason. */
  async step(ctx: ActionContext, deps: LaneDeps): Promise<void> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.gate = gate;
    try {
      await this.prime();
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
    this.last = null;
    this.completed = false;
    this.failed = false;
    this.shortfall = null;
    this.state = 'idle';
    this.cursor = 0;
    this.counts = {};
    this.skipped = [];
    this.primed = 0;
    this.layers.reset();
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
    return (
      this.plan !== null &&
      (this.state === 'running' ||
        this.state === 'waiting_materials' ||
        this.state === 'waiting_tps')
    );
  }

  private async slice(ctx: ActionContext, deps: LaneDeps): Promise<void> {
    const began = deps.now();
    while (this.runnable() && deps.now() - began < SLICE_TICKS) {
      if (ctx.signal.aborted) return;
      const plan = this.plan;
      if (plan === null) return;
      const cell = plan.source.at(this.cursor);
      // The source is read forward: `primed` tracks its read position, so a later prime never goes back.
      this.primed = Math.max(this.primed, this.cursor + 1);
      if (cell === undefined) {
        this.plan = null;
        this.state = 'idle';
        this.completed = true;
        return;
      }
      const verdict = this.throttle(deps);
      // No cell this tick: the gap or TPS holds it. The next tick asks again.
      if (verdict === 'gap') return;
      if (verdict === 'tps') {
        this.state = 'waiting_tps';
        return;
      }
      // A throttle that threw cancels the cell: the cursor stays, the lane keeps running.
      if (verdict === 'error') return;
      if (this.state === 'waiting_tps') this.state = 'running';
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      ctx.signal.addEventListener('abort', stop, { once: true });
      this.inFlight = ctl;
      let code: CellCode;
      try {
        code = await doCellAt(
          { ...ctx, signal: ctl.signal },
          cell,
          deps.env,
          deps.handlers,
          (cells) => this.removalsFor(plan, cells),
        );
      } finally {
        ctx.signal.removeEventListener('abort', stop);
        this.inFlight = null;
      }
      // A pause, a death or a runtime stop ended the cell: the cursor stays so the cell is re-read.
      if (!this.runnable() || code === 'cancelled') return;
      if (code === 'missing_materials') {
        const block = parseBlockRef(cell.target).name;
        this.shortfall = { block, have: countMaterials(deps.env.held(), block), need: 1 };
        this.state = 'waiting_materials';
        return;
      }
      this.shortfall = null;
      this.count(code);
      deps.onCell?.(code);
      if (!DONE.has(code)) {
        this.skipped.push({ at: [cell.at.x, cell.at.y, cell.at.z], code });
      }
      this.cursor++;
      this.state = 'running';
      if (this.cursor >= plan.total) {
        this.plan = null;
        this.state = 'idle';
        this.completed = true;
        return;
      }
    }
  }

  /**
   * The cells among `cells` that the plan works, for scaffold removal: judged per y layer from a
   * fresh source of the plan, in slices that yield. A plan without `fresh` answers none.
   */
  async removalsFor(plan: LanePlan, cells: readonly Cell[]): Promise<Cell[]> {
    if (plan.fresh === undefined) return [];
    return this.layers.onPlanOf(cells, plan.fresh, () => COUNT_SLICE, this.yieldLoop);
  }

  /**
   * Reads the plan's cells up to the cursor in slices, yielding between them. A resume from a
   * cursor N moves the source forward N cells here, not in one synchronous call inside a cell.
   */
  private async prime(): Promise<void> {
    const plan = this.plan;
    while (plan !== null && this.plan === plan && this.primed < this.cursor) {
      const before = this.primed;
      const to = Math.min(this.cursor, this.primed + COUNT_SLICE);
      await forEachCellSliced(
        plan.source,
        this.primed,
        to,
        () => COUNT_SLICE,
        (_cell, i) => {
          this.primed = i + 1;
        },
      );
      // A death or a new plan during the yield ends the walk: nothing past this slice is read.
      // A source that ends before the cursor reads nothing more: the walk stops rather than spin.
      if (this.primed === before) return;
      if (this.primed < this.cursor && this.plan === plan) await this.yieldLoop();
    }
  }

  /** The throttle's verdict for the next cell; a throw is `error` (the cell is cancelled). */
  private throttle(deps: LaneDeps): ThrottleVerdict | 'error' {
    if (deps.beforeCell === undefined) return 'go';
    try {
      return deps.beforeCell(deps.now());
    } catch {
      return 'error';
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
