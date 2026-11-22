// Plan queue (BLD-14). One plan runs at a time per life; the others wait in order. `add` takes its
// steps in chunks (seq 0, 1, ... with final on the last; a single message is one chunk). A bad seq
// drops the upload and refuses: the Mind sends again from seq 0. `replace` drops the unexecuted
// cells of a plan and keeps the placed ones. `cancel` drops one plan or all of them; the lane stops
// within one slice. A reflex or a foreground intent holds the lane through `Contention`.
// There is no retry and no cap on chunks or plans here: a refusal is a reply, not a retry.

import { errorText } from '../actions/outcome.ts';
import type { ActionContext } from '../actions/registry.ts';
import type { PlanCell } from './cell-do.ts';
import type { Contention } from './contention.ts';
import type { LaneDeps, LanePlan, PlanLane } from './lane.ts';

/** The plan body a chunk carries: the palette and steps, and where and in what order they go. */
export interface PlanBody {
  palette: Readonly<Record<string, unknown>>;
  steps: readonly unknown[];
  origin?: unknown;
  order?: unknown;
}

/** Turns a whole plan body into the cells the lane runs. The geometry lives outside this module. */
export type PlanExpand = (body: PlanBody) => readonly PlanCell[];

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

export interface PlanQueueOptions {
  lifeId: string;
  lane: QueueLane;
  contention: Contention;
  expand: PlanExpand;
}

interface Upload {
  op: 'add' | 'replace';
  nextSeq: number;
  body: PlanBody;
  steps: unknown[];
}

interface Entry {
  planId: string;
  cells: readonly PlanCell[];
  chunks: number;
}

function cellKey(c: PlanCell): string {
  return `${c.at.x},${c.at.y},${c.at.z}`;
}

/** The plan queue of one life, in front of the plan lane. */
export class PlanQueue {
  private readonly lifeId: string;
  private readonly lane: QueueLane;
  private readonly contention: Contention;
  private readonly expand: PlanExpand;
  private readonly uploads = new Map<string, Upload>();
  private readonly waiting: Entry[] = [];
  private active: Entry | null = null;

  constructor(options: PlanQueueOptions) {
    this.lifeId = options.lifeId;
    this.lane = options.lane;
    this.contention = options.contention;
    this.expand = options.expand;
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
      await this.dropActive();
      dropped++;
    }
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const entry = this.waiting[i];
      if (entry !== undefined && match(entry.planId)) {
        this.waiting.splice(i, 1);
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
    if (this.lane.state === 'idle') this.active = null;
  }

  private async apply(
    op: 'add' | 'replace',
    planId: string,
    body: PlanBody,
    chunks: number,
  ): Promise<SubmitReply> {
    let cells: readonly PlanCell[];
    try {
      cells = this.expand(body);
    } catch (error) {
      return { kind: 'refused', message: `plan ${planId} does not expand: ${errorText(error)}` };
    }
    if (op === 'add') {
      if (this.isKnown(planId))
        return { kind: 'refused', message: `plan ${planId} already exists` };
      this.waiting.push({ planId, cells, chunks });
      return { kind: 'queued', cells: cells.length, position: this.waiting.length };
    }
    if (this.active?.planId === planId) {
      const cursor = this.lane.checkpointState()?.cursor ?? 0;
      const placed = new Set(this.active.cells.slice(0, cursor).map(cellKey));
      await this.dropActive();
      const rest = cells.filter((c) => !placed.has(cellKey(c)));
      this.waiting.unshift({ planId, cells: rest, chunks });
      return { kind: 'queued', cells: rest.length, position: 1 };
    }
    const idx = this.waiting.findIndex((e) => e.planId === planId);
    if (idx < 0) return { kind: 'refused', message: `no plan ${planId} to replace` };
    this.waiting[idx] = { planId, cells, chunks };
    return { kind: 'queued', cells: cells.length, position: idx + 1 };
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
      cells: entry.cells,
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
