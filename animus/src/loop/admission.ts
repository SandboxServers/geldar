/**
 * Admission (spec 5.3.4, 5.7; orchestrator ruling Q4): a rolling-hour counter against
 * `mind.admission.max_thoughts_per_real_hour`. A thought costs 1, a reflection 2. Over the cap the
 * caller gets a "tired" result and makes no model call. The clock is injected; the counter never
 * reads the wall clock itself.
 */

import {
  type AdmissionReservation,
  REFLECTION_COST,
  type ReflectionAdmission,
  THOUGHT_COST,
} from '../ports/index.ts';

export { REFLECTION_COST, THOUGHT_COST };

/** The reservation type, as the port names it. */
export type Reservation = AdmissionReservation;

const HOUR_MS = 3_600_000;

/** One counter per life: the thinking loop and the reflection share this one instance. */
export class Admission implements ReflectionAdmission {
  private readonly cap: number;
  private readonly now: () => number;
  private readonly spent: { at: number; cost: number; released: boolean; settled: boolean }[] = [];

  constructor(maxThoughtsPerRealHour: number, now: () => number = Date.now) {
    this.cap = maxThoughtsPerRealHour;
    this.now = now;
  }

  /** Credits left in the rolling hour, never below zero. */
  remaining(): number {
    return Math.max(0, this.cap - this.used());
  }

  /** Reserves `cost` credits, or returns null when they would take the hour over the cap. */
  reserve(cost: number): Reservation | null {
    if (this.used() + cost > this.cap) return null;
    const entry = { at: this.now(), cost, released: false, settled: false };
    this.spent.push(entry);
    return {
      cost,
      settle: () => {
        entry.settled = true;
      },
      release: () => {
        if (!entry.settled) entry.released = true;
      },
    };
  }

  /** Credits spent in the last hour; drops older entries. */
  private used(): number {
    const cutoff = this.now() - HOUR_MS;
    while (this.spent.length > 0 && (this.spent[0]?.at ?? 0) <= cutoff) this.spent.shift();
    return this.spent.reduce((sum, e) => sum + (e.released ? 0 : e.cost), 0);
  }
}
