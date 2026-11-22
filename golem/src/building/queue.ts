// Plan queue (BLD-14). One plan runs at a time per life; the others wait in order. `add` takes its
// steps in chunks (seq 0, 1, ... with final on the last; a single message is one chunk). A bad seq
// drops the upload and refuses: the Mind sends again from seq 0. `replace` drops the unexecuted
// cells of a plan and keeps the placed ones. `cancel` drops one plan or all of them; the lane stops
// within one slice. A reflex or a foreground intent holds the lane through `Contention`.
// There is no retry and no cap on chunks or plans here: a refusal is a reply, not a retry.

import { errorText } from '../actions/outcome.ts';
import type { ActionContext } from '../actions/registry.ts';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource, cellsOf, filteredCellSource } from './cell-source.ts';
import type { Contention } from './contention.ts';
import type { LaneDeps, LanePlan, PlanLane } from './lane.ts';
import type { SkippedCell } from './plan-checkpoint.ts';
import { countPlanCells } from './wire-expand.ts';

/** The plan body a chunk carries: the palette and steps, and where and in what order they go. */
export interface PlanBody {
  palette: Readonly<Record<string, unknown>>;
  steps: readonly unknown[];
  origin?: unknown;
  order?: unknown;
}

/**
 * Turns a plan body into a source of the cells the lane runs. Each call returns a fresh source (a
 * source is read forward only and a count uses it up). The geometry lives outside this module.
 */
export type PlanExpand = (body: PlanBody) => CellSource;

/** One `plan` add or replace message. `seq` is absent on a single message; `final` marks the last chunk. */
export interface PlanChunk {
  planId: string;
  op: 'add' | 'replace';
  final: boolean;
  seq?: number;
  body: PlanBody;
}

/** The reply to a chunk: still uploading, queued (or replaced) with its cell count, or refused. */
export type SubmitReply =
  | { kind: 'uploading'; nextSeq: number }
  | { kind: 'queued'; cells: number; position: number }
  | { kind: 'refused'; message: string };

/** What the queue needs from the lane: the PlanLane surface, so a fake can stand in for it. */
export type QueueLane = Pick<
  PlanLane,
  'state' | 'start' | 'step' | 'pauseForReflex' | 'resume' | 'endForDeath' | 'checkpointState'
>;

/**
 * Optional persistence the queue calls (BLD-05 wiring). `stored` runs before a plan is queued or
 * replaces one, and returns how many chunks it was kept in; a throw refuses the message. `dropped`
 * runs when a plan leaves the queue (cancel, or finished). `progressed` runs after each lane slice.
 */
export interface PlanQueueStore {
  stored(planId: string, cells: readonly PlanCell[]): Promise<number>;
  dropped(planId: string): Promise<void>;
  progressed(lane: QueueLane): void;
}

export interface PlanQueueOptions {
  lifeId: string;
  lane: QueueLane;
  contention: Contention;
  expand: PlanExpand;
  /** Persists plans and progress; left out, the queue is in memory only (as before). */
  store?: PlanQueueStore;
}

interface Upload {
  op: 'add' | 'replace';
  nextSeq: number;
  body: PlanBody;
  steps: unknown[];
}

/** A queued or active plan: a factory for fresh sources of its cells, its exact count and its chunks. */
interface Entry {
  planId: string;
  make: () => CellSource;
  total: number;
  chunks: number;
}

function cellKey(c: PlanCell): string {
  return `${c.at.x},${c.at.y},${c.at.z}`;
}

/** The keys of the first `count` cells of a source (the cells a lane has placed or passed). */
function keysBefore(source: CellSource, count: number): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < count; i++) {
    const cell = source.at(i);
    if (cell === undefined) break;
    keys.add(cellKey(cell));
  }
  return keys;
}

/** The plan queue of one life, in front of the plan lane. */
export class PlanQueue {
  private readonly lifeId: string;
  private readonly lane: QueueLane;
  private readonly contention: Contention;
  private readonly expand: PlanExpand;
  private readonly store: PlanQueueStore | null;
  private readonly uploads = new Map<string, Upload>();
  private readonly waiting: Entry[] = [];
  private active: Entry | null = null;

  constructor(options: PlanQueueOptions) {
    this.lifeId = options.lifeId;
    this.lane = options.lane;
    this.contention = options.contention;
    this.expand = options.expand;
    this.store = options.store ?? null;
  }

  /** Takes one plan message. A final chunk is joined with its earlier chunks and then queued or replaced. */
  async submit(chunk: PlanChunk): Promise<SubmitReply> {
    const { planId } = chunk;
    if (chunk.seq === undefined && !chunk.final) {
      return { kind: 'refused', message: `plan ${planId}: a chunk that is not final needs seq` };
    }
    const seq = chunk.seq ?? 0;
    if (seq !== 0) {
      const prev = this.uploads.get(planId);
      if (prev === undefined || prev.nextSeq !== seq) {
        this.uploads.delete(planId);
        const expected = prev?.nextSeq ?? 0;
        return {
          kind: 'refused',
          message: `plan ${planId}: expected seq ${expected}, got ${seq}; send again from seq 0`,
        };
      }
    }
    const up: Upload =
      seq === 0
        ? { op: chunk.op, nextSeq: 0, body: chunk.body, steps: [] }
        : (this.uploads.get(planId) as Upload);
    up.steps.push(...chunk.body.steps);
    up.nextSeq = seq + 1;
    if (!chunk.final) {
      this.uploads.set(planId, up);
      return { kind: 'uploading', nextSeq: up.nextSeq };
    }
    this.uploads.delete(planId);
    return this.apply(up.op, planId, { ...up.body, steps: up.steps }, up.nextSeq);
  }

  /** Cancels one plan by id, or every plan with `all`. Returns how many plans were dropped. */
  async cancel(planId: string): Promise<number> {
    const match = (id: string) => planId === 'all' || id === planId;
    for (const id of [...this.uploads.keys()]) {
      if (match(id)) this.uploads.delete(id);
    }
    let dropped = 0;
    if (this.active !== null && match(this.active.planId)) {
      const id = this.active.planId;
      await this.dropActive();
      await this.store?.dropped(id);
      dropped++;
    }
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const entry = this.waiting[i];
      if (entry !== undefined && match(entry.planId)) {
        this.waiting.splice(i, 1);
        await this.store?.dropped(entry.planId);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * One Body slice. Starts the next queued plan when none is active, holds the lane while a reflex
   * or a foreground intent does, and otherwise runs the lane's slice.
   */
  async step(ctx: ActionContext, deps: LaneDeps): Promise<void> {
    this.startNext();
    if (this.contention.held) {
      await this.lane.pauseForReflex();
      return;
    }
    await this.lane.step(ctx, deps);
    this.store?.progressed(this.lane);
    if (this.lane.state === 'idle' && this.active !== null) {
      const id = this.active.planId;
      this.active = null;
      await this.store?.dropped(id);
    }
  }

  /**
   * Puts back a plan saved before a restart, from its cursor, as the active plan. Refused (false)
   * when a plan is already active. The cells come from the store; nothing is re-expanded.
   */
  restore(
    entry: { planId: string; cells: readonly PlanCell[]; chunks: number },
    cursor: number,
    saved?: { counts: Record<string, number>; skipped: SkippedCell[] },
  ): boolean {
    if (this.active !== null || this.lane.state !== 'idle') return false;
    const total = entry.cells.length;
    const make = () => arrayCellSource(entry.cells);
    const started = this.lane.start(
      {
        lifeId: this.lifeId,
        planId: entry.planId,
        chunks: entry.chunks,
        source: make(),
        total,
        cursor,
      },
      saved,
    );
    if (started) this.active = { planId: entry.planId, make, total, chunks: entry.chunks };
    return started;
  }

  private async apply(
    op: 'add' | 'replace',
    planId: string,
    body: PlanBody,
    chunks: number,
  ): Promise<SubmitReply> {
    const make = () => this.expand(body);
    let total: number;
    try {
      total = await countPlanCells(make());
    } catch (error) {
      return { kind: 'refused', message: `plan ${planId} does not expand: ${errorText(error)}` };
    }
    if (op === 'add') {
      if (this.isKnown(planId))
        return { kind: 'refused', message: `plan ${planId} already exists` };
      const kept = await this.keep(planId, make, chunks);
      if (typeof kept !== 'number') return kept;
      this.waiting.push({ planId, make, total, chunks: kept });
      return { kind: 'queued', cells: total, position: this.waiting.length };
    }
    if (this.active?.planId === planId) {
      const cursor = this.lane.checkpointState()?.cursor ?? 0;
      const placed = keysBefore(this.active.make(), cursor);
      const rest = () => filteredCellSource(make(), (c) => !placed.has(cellKey(c)));
      const restTotal = await countPlanCells(rest());
      const kept = await this.keep(planId, rest, chunks);
      if (typeof kept !== 'number') return kept;
      await this.dropActive();
      this.waiting.unshift({ planId, make: rest, total: restTotal, chunks: kept });
      return { kind: 'queued', cells: restTotal, position: 1 };
    }
    const idx = this.waiting.findIndex((e) => e.planId === planId);
    if (idx < 0) return { kind: 'refused', message: `no plan ${planId} to replace` };
    const kept = await this.keep(planId, make, chunks);
    if (typeof kept !== 'number') return kept;
    this.waiting[idx] = { planId, make, total, chunks: kept };
    return { kind: 'queued', cells: total, position: idx + 1 };
  }

  /**
   * Stores a plan through the store, if any. Returns its chunk count, or a refusal when the store fails.
   * The store takes an array (its format is unchanged), so a stored plan is read whole here.
   */
  private async keep(
    planId: string,
    make: () => CellSource,
    chunks: number,
  ): Promise<number | SubmitReply> {
    if (this.store === null) return chunks;
    try {
      return await this.store.stored(planId, cellsOf(make()));
    } catch (error) {
      return { kind: 'refused', message: `plan ${planId} not stored: ${errorText(error)}` };
    }
  }

  /** Plans held now: the active one and those waiting (the queue depth metric). */
  depth(): number {
    return (this.active === null ? 0 : 1) + this.waiting.length;
  }

  private isKnown(planId: string): boolean {
    return this.active?.planId === planId || this.waiting.some((e) => e.planId === planId);
  }

  private startNext(): void {
    if (this.active !== null) return;
    const entry = this.waiting.shift();
    if (entry === undefined) return;
    this.active = entry;
    const plan: LanePlan = {
      lifeId: this.lifeId,
      planId: entry.planId,
      chunks: entry.chunks,
      source: entry.make(),
      fresh: entry.make,
      total: entry.total,
    };
    this.lane.start(plan);
  }

  /** Drops the active plan from the lane: the in-flight cell is aborted and the lane is idle on return. */
  private async dropActive(): Promise<void> {
    this.active = null;
    // The lane has no cancel of its own yet; its drop path clears the plan and aborts the cell.
    await this.lane.endForDeath(0);
  }
}
