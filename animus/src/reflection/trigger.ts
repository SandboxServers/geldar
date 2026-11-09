/**
 * Decides whether a `ReflectionDue` becomes a reflection (spec 5.4, 5.7): at most one per in-game
 * day (`agents.last_sleep_day`), only when admission grants the cost of 2, and only in the agent's
 * single in-flight slot (R13), which it takes through the attention controller. It also keeps the
 * events and inventory readings seen since the last reflection, which the digest is built from.
 */
import type {
  AttentionController,
  MemoryStore,
  MindEvent,
  ReflectionDue,
  ThoughtOutcome,
} from '../ports/index.ts';
import type { InventoryReading } from './digest.ts';
import { REFLECTION_COST, type ReflectInput, type ReflectResult } from './reflect.ts';

/** A granted reservation of credits. Exactly one of `settle` and `release` is called. */
export interface AdmissionReservation {
  /** The call ran: charge the reserved cost. */
  settle(): void;
  /** The call never ran: give the reservation back. */
  release(): void;
}

/** The admission scheduler as the reflection sees it (spec 5.7). No P0-21 port exists yet. */
export interface ReflectionAdmission {
  /** Reserves `cost` credits, or returns null when the agent cannot afford them or has no capacity. */
  reserve(cost: number): AdmissionReservation | null;
}

/** Why a due reflection did not run. */
export type SkipReason = 'already_slept' | 'busy' | 'not_admitted' | 'other_life';

/** What `handle` did. */
export type TriggerResult =
  | { ran: true; result: ReflectResult }
  | { ran: false; reason: SkipReason };

/** What the trigger needs. */
export interface TriggerDeps {
  lifeId: string;
  store: MemoryStore;
  attention: AttentionController;
  admission: ReflectionAdmission;
  /** Runs the reflection; normally `reflectOnce` with its dependencies bound. */
  run: (input: ReflectInput) => Promise<ReflectResult>;
  /** True while a thought of the thinking loop is running; the reflection then waits. */
  thinking?: () => boolean;
}

const EVENT_CAP = 5000;
const READING_CAP = 500;

const SETTLED: Record<ReflectResult['outcome'], ThoughtOutcome> = {
  applied: 'fallback_hold',
  degraded: 'fallback_hold',
  invalid_output: 'invalid_output',
  model_error: 'model_error',
  apply_failed: 'model_error',
};

/** The reflection trigger of one life. */
export class ReflectionTrigger {
  private events: MindEvent[] = [];
  private inventory: InventoryReading[] = [];
  private sinceTick: number;
  private inFlight = false;
  private pending: ReflectionDue | null = null;

  private readonly deps: TriggerDeps;

  constructor(deps: TriggerDeps, sinceTick = 0) {
    this.deps = deps;
    this.sinceTick = sinceTick;
  }

  /** Keeps an event for the next digest. Never throws. */
  observe(event: MindEvent): void {
    if (event.lifeId !== this.deps.lifeId) return;
    this.events.push(event);
    if (this.events.length > EVENT_CAP) this.events.splice(0, this.events.length - EVENT_CAP);
  }

  /** Keeps an inventory reading (taken from a snapshot) for the windfall check. */
  observeInventory(reading: InventoryReading): void {
    this.inventory.push(reading);
    if (this.inventory.length > READING_CAP) this.inventory.shift();
  }

  /** True while a reflection runs. */
  get busy(): boolean {
    return this.inFlight;
  }

  /** Handles one due reflection. A `busy` one is kept and tried again by `resume`. */
  async handle(due: ReflectionDue): Promise<TriggerResult> {
    if (due.lifeId !== this.deps.lifeId) return { ran: false, reason: 'other_life' };
    if (this.inFlight || this.deps.thinking?.() === true) {
      this.pending = due;
      return { ran: false, reason: 'busy' };
    }
    // Hold the slot before the first await, so a second due cannot slip in while we load.
    this.inFlight = true;
    let started = false;
    let outcome: ThoughtOutcome = 'model_error';
    try {
      const { agent } = await this.deps.store.loadDeterministic(due.lifeId, due.event.tick);
      if (agent.lastSleepDay !== null && agent.lastSleepDay >= due.day) {
        return { ran: false, reason: 'already_slept' };
      }
      const reservation = this.deps.admission.reserve(REFLECTION_COST);
      if (reservation === null) return { ran: false, reason: 'not_admitted' };
      this.pending = null;
      started = true;
      this.deps.attention.thoughtStarted();
      return await this.runReserved(due, reservation, (o) => {
        outcome = o;
      });
    } finally {
      this.inFlight = false;
      if (started) this.deps.attention.thoughtSettled(outcome);
    }
  }

  private async runReserved(
    due: ReflectionDue,
    reservation: AdmissionReservation,
    settled: (outcome: ThoughtOutcome) => void,
  ): Promise<TriggerResult> {
    try {
      const result = await this.deps.run({
        due,
        sinceTick: this.sinceTick,
        events: [...this.events],
        inventory: [...this.inventory],
      });
      settled(SETTLED[result.outcome]);
      reservation.settle();
      if (result.outcome === 'applied' || result.outcome === 'degraded') {
        this.sinceTick = due.event.tick;
        this.events = this.events.filter((e) => e.tick > due.event.tick);
        this.inventory = this.inventory.filter((r) => r.tick > due.event.tick);
      }
      return { ran: true, result };
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  /** Runs the reflection that was held back while busy, if it is still wanted. */
  async resume(): Promise<TriggerResult | null> {
    const due = this.pending;
    if (due === null) return null;
    return this.handle(due);
  }
}
