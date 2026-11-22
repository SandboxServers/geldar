// Plan persistence for one Body (BLD-05 wiring, BLD-13 resume). A queued plan is stored as its cells
// (JSON, chunked under the KV value limit) in the plan bucket, and the lane's cursor is saved to the
// checkpoint bucket in the background. After a restart `resumePlanLane` puts the saved plan back as
// the active plan, from its cursor. Cells are stored, not the plan body, so `origin: "here"` is not
// resolved again at restart.
import { errorText } from '../actions/outcome.ts';
import type { BodyKv } from '../body/checkpoint.ts';
import type { PlanCell } from './cell-do.ts';
import {
  checkpointKey,
  loadCheckpoint,
  type PlanCheckpoint,
  PlanCheckpointWriter,
} from './plan-checkpoint.ts';
import { chunkKey, deletePlan, type PlanKv, readPlan, writePlan } from './plan-store.ts';
import type { PlanQueue, PlanQueueStore, QueueLane } from './queue.ts';

/** Adapts a restart bucket to the plan store's KV surface (create or update on put). */
export function planKvOf(kv: BodyKv): PlanKv {
  return {
    async put(key, value) {
      const entry = await kv.get(key);
      return entry === null ? kv.create(key, value) : kv.update(key, value, entry.revision);
    },
    async get(key) {
      const entry = await kv.get(key);
      return entry === null ? null : entry.value;
    },
    delete: (key) => kv.delete(key),
  };
}

export interface PlanPersistenceOptions {
  lifeId: string;
  /** The plan bucket (chunks of the cells of each queued plan). */
  plans: PlanKv;
  /** The checkpoint bucket (the lane cursor under `<life_id>.plan`). */
  checkpoints: PlanKv;
  /** Where failures are reported; default `console.warn`. */
  log?: (line: string) => void;
}

/** The queue's store: plans go to the plan bucket, progress to the checkpoint bucket. */
export class PlanPersistence implements PlanQueueStore {
  readonly lifeId: string;
  private readonly plans: PlanKv;
  private readonly checkpoints: PlanKv;
  private readonly log: (line: string) => void;
  private readonly writer: PlanCheckpointWriter;
  /** Chunk count of each plan this life has stored. */
  private readonly counts = new Map<string, number>();

  constructor(options: PlanPersistenceOptions) {
    this.lifeId = options.lifeId;
    this.plans = options.plans;
    this.checkpoints = options.checkpoints;
    this.log = options.log ?? ((line) => console.warn(line));
    this.writer = new PlanCheckpointWriter({
      kv: options.checkpoints,
      lifeId: options.lifeId,
      log: this.log,
    });
  }

  /** Writes the cells as chunks; a surplus of older chunks is removed. Throws when the write fails. */
  async stored(planId: string, cells: readonly PlanCell[]): Promise<number> {
    const count = await writePlan(this.plans, this.lifeId, planId, JSON.stringify(cells));
    const prev = this.counts.get(planId) ?? 0;
    this.counts.set(planId, count);
    for (let seq = count; seq < prev; seq++) {
      try {
        await this.plans.delete(chunkKey(this.lifeId, planId, seq));
      } catch (error) {
        this.log(`plan chunk ${seq} of ${planId} not removed: ${errorText(error)}`);
      }
    }
    return count;
  }

  /** Removes a plan's chunks and, once it is saved, the checkpoint. Best effort: failures are logged. */
  async dropped(planId: string): Promise<void> {
    const count = this.counts.get(planId);
    if (count !== undefined) {
      this.counts.delete(planId);
      try {
        await deletePlan(this.plans, this.lifeId, planId, count);
      } catch (error) {
        this.log(`plan ${planId} not removed: ${errorText(error)}`);
      }
    }
    await this.writer.flush();
    try {
      // The life has one checkpoint, and it is the active plan's: a waiting plan's drop leaves it.
      const saved = await loadCheckpoint(this.checkpoints, this.lifeId);
      if (saved !== null && saved.plan_id !== planId) return;
      await this.checkpoints.delete(checkpointKey(this.lifeId));
    } catch (error) {
      this.log(`plan checkpoint for ${this.lifeId} not removed: ${errorText(error)}`);
    }
  }

  /** Writes the queued lane cursor now; a Body stop calls this so the last cursor is not lost. */
  async flush(): Promise<void> {
    await this.writer.flush();
  }

  /** Queues the lane's cursor for a background save. Nothing is saved when no plan runs. */
  progressed(lane: QueueLane): void {
    const state = lane.checkpointState();
    if (state !== null) this.writer.save(state);
  }

  /** The saved checkpoint of this life, or null (missing or unreadable: logged, treated as none). */
  async readCheckpoint(): Promise<PlanCheckpoint | null> {
    try {
      return await loadCheckpoint(this.checkpoints, this.lifeId);
    } catch (error) {
      this.log(`plan checkpoint for ${this.lifeId} not read: ${errorText(error)}`);
      return null;
    }
  }

  /** Reads a stored plan's cells back. Throws when a chunk is missing or the cells do not parse. */
  async readCells(planId: string, chunks: number): Promise<PlanCell[]> {
    const cells: unknown = JSON.parse(await readPlan(this.plans, this.lifeId, planId, chunks));
    if (!Array.isArray(cells)) throw new Error(`plan ${planId} is not a list of cells`);
    return cells as PlanCell[];
  }

  /** Records a plan found in the store, so a later drop removes its chunks. */
  adopt(planId: string, chunks: number): void {
    this.counts.set(planId, chunks);
  }
}

/** What a restart's resume reached: nothing saved, the plan put back, or a failure (logged, plan not run). */
export type ResumeResult = 'none' | 'resumed' | 'failed';

/**
 * Puts a plan saved before a restart back on the queue, from its checkpoint cursor. A missing
 * checkpoint is `none`. A checkpoint whose plan cannot be read whole is `failed`: the plan is not
 * run (no partial plan) and the Mind is asked for it again by the `no_plan` wake.
 */
export async function resumePlanLane(
  queue: PlanQueue,
  persistence: PlanPersistence,
  log: (line: string) => void = (line) => console.warn(line),
): Promise<ResumeResult> {
  const saved = await persistence.readCheckpoint();
  if (saved === null) return 'none';
  try {
    const cells = await persistence.readCells(saved.plan_id, saved.chunks);
    const entry = { planId: saved.plan_id, cells, chunks: saved.chunks };
    const counts = { counts: saved.counts, skipped: saved.skipped };
    if (!queue.restore(entry, saved.cursor, counts)) return 'failed';
    persistence.adopt(saved.plan_id, saved.chunks);
    return 'resumed';
  } catch (error) {
    log(`plan ${saved.plan_id} not resumed: ${errorText(error)}`);
    return 'failed';
  }
}
