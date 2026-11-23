// The plan's progress cadence (BLD-38f2). After each lane step the Body's wiring hands the lane's
// snapshot here. A plan_progress event goes out on a phase change (paused, waiting_tps,
// waiting_materials, completed), every 25 cells or 30 seconds (progress.ts), and the completed plan
// raises its goal_completed wake once. Counts only: no cell position, block or seen-map sample.
import type { RecordSink } from '../body/records.ts';
import type { LaneSnapshot, MaterialsShortfall } from './lane.ts';
import { buildProgressPayload, completedWake, MaterialsWait, progressDue } from './progress.ts';

/** The sink hooks the emitter uses: the progress event (optional on a sink) and the wake. */
export type PlanProgressSink = Pick<RecordSink, 'wake'> & Partial<Pick<RecordSink, 'planProgress'>>;

/** Emits one Body's plan progress. One emitter per Body; it keeps the last event's cells and time. */
export class PlanProgressEmitter {
  private planId: string | null = null;
  private phase: LaneSnapshot['phase'] | null = null;
  private cells = 0;
  private at = 0;
  private completedFor: string | null = null;
  private readonly sink: PlanProgressSink;
  private readonly clock: () => number;
  private readonly materials = new MaterialsWait();

  constructor(sink: PlanProgressSink, clock: () => number) {
    this.sink = sink;
    this.clock = clock;
  }

  /**
   * Called after each lane step with the lane's materials shortfall (null when it is not waiting).
   * The Mind is woken once per wait (progress.ts MaterialsWait); a wait ends when the shortfall clears.
   */
  observeShortfall(shortfall: MaterialsShortfall | null, tick: number): void {
    if (shortfall === null) {
      this.materials.resumed();
      return;
    }
    const wake = this.materials.waiting(shortfall.block, shortfall.have, shortfall.need);
    if (wake !== null) {
      this.sink.wake({ reason: wake.reason, tick, intentId: null, detail: wake.detail });
    }
  }

  /** Called after each lane step with the lane's snapshot (null before any plan: nothing is sent). */
  observe(snapshot: LaneSnapshot | null, tick: number): void {
    if (snapshot === null) return;
    const payload = buildProgressPayload({
      planId: snapshot.planId,
      total: snapshot.total,
      counts: snapshot.counts,
      phase: snapshot.phase,
    });
    const now = this.clock();
    if (snapshot.planId !== this.planId) {
      this.planId = snapshot.planId;
      this.phase = null;
      this.cells = 0;
      this.at = now;
    }
    const phaseChanged = snapshot.phase !== this.phase;
    if (phaseChanged || progressDue(payload.done - this.cells, now - this.at)) {
      this.sink.planProgress?.(payload, tick);
      this.phase = snapshot.phase;
      this.cells = payload.done;
      this.at = now;
    }
    if (snapshot.phase === 'completed' && this.completedFor !== snapshot.planId) {
      this.completedFor = snapshot.planId;
      // completedWake's reason is always goal_completed (a WakeReason); its detail is the sentence.
      this.sink.wake({
        reason: 'goal_completed',
        tick,
        intentId: null,
        detail: completedWake(payload).detail,
      });
    }
  }
}
