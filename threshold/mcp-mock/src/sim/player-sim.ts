import type { Intent } from '@geldar/contract';
import type { IdPrefix } from '../ids.ts';
import { msAt, tickAt } from './clock.ts';
import { EventLog, type SimEvent } from './events.ts';
import { advanceIntent, type IntentState, intentEndTick, startIntent } from './intent.ts';
import { type ReflexStack, tryEat } from './reflex.ts';
import type { Scenario } from './scenario.ts';

/** Half a day: the gap between dawn and dusk. */
const HALF_DAY = 12000;
const DAY = 24000;
/** Steps one `syncTo` plays before it skips a quiet stretch. */
const MAX_CATCHUP_STEPS = 10000;
/** How many ids the receipts ledger keeps; the oldest drop first. */
const RECEIPT_LIMIT = 1000;

/** What a `PlayerSim` is built from. */
export interface PlayerSimInit {
  scenario: Scenario;
  /** The clock time of tick 0. */
  startMs: number;
  /** Makes the next id of a kind (`in_...`, `ac_...`). */
  nextId: (prefix: IdPrefix) => string;
}

function nextMultiple(after: number, step: number): number {
  return (Math.floor(after / step) + 1) * step;
}

/** One player's world: the event log, the running intent, food, facts, driven by `syncTo`. No model. */
export class PlayerSim {
  readonly scenario: Scenario;
  readonly startMs: number;
  readonly nextId: (prefix: IdPrefix) => string;
  /** The events so far. */
  readonly log: EventLog = new EventLog();
  /** The facts that hold now; scenario `set_fact` and `clear_fact` events change them. */
  readonly facts: Set<string>;
  /** Food level, 0 to 20. */
  food: number;
  /** What the player carries; the eat reflex takes from it and replaces the list. */
  inventory: ReflexStack[];
  /** Thoughts left. Held for later tools; the sim never spends it. */
  budget: number;
  /** When the model last woke, or null. */
  lastWakeMs: number | null = null;
  /** Seqs recorded as suppressed wakes. */
  readonly suppressedSeqs: Set<number> = new Set();
  /** The tick reached by the last `syncTo`. */
  tick = 0;
  /** The private ledger of `ac_` and `in_` ids, the last 1000. No tool result carries it. */
  readonly receipts: string[] = [];
  /** The clock time the running intent started, or null. */
  intentStartedMs: number | null = null;
  private current: IntentState | null = null;
  private nextScenarioEvent = 0;

  /** Builds the world at tick 0 from the scenario's character: facts, food, inventory, budget. */
  constructor(init: PlayerSimInit) {
    this.scenario = init.scenario;
    this.startMs = init.startMs;
    this.nextId = init.nextId;
    const c = init.scenario.character;
    this.facts = new Set(c.facts);
    this.food = c.food;
    this.inventory = c.inventory.map((s) => ({ ...s }));
    this.budget = c.budget;
  }

  /** The running intent, or null. */
  intent(): IntentState | null {
    return this.current;
  }

  /** Starts an intent at the current time (after syncing to it); replaces a running one. */
  startIntent(spec: Intent, nowMs: number): ReturnType<typeof startIntent> {
    this.syncTo(nowMs);
    const r = startIntent(spec, this.tick, this.scenario.intent.default_ticks, this.facts);
    if (r.ok) {
      // The id is made only now, so a rejected start burns none.
      const id = this.nextId('in');
      r.state.id = id;
      this.current = r.state;
      this.intentStartedMs = nowMs;
      this.receipts.push(id);
      if (this.receipts.length > RECEIPT_LIMIT)
        this.receipts.splice(0, this.receipts.length - RECEIPT_LIMIT);
    }
    return r;
  }

  /**
   * Drops the running intent without an event. It does not sync: call `syncTo(now)` first, or an
   * intent that already ended before now is dropped silently instead of logging its end.
   */
  cancelIntent(): void {
    this.current = null;
    this.intentStartedMs = null;
  }

  /**
   * The clock time of the next scenario event, day/night boundary, hunger step or intent end. The
   * half-day boundary and the hunger step always count, so a wait on `day_night` wakes at dusk even
   * with no event or intent pending. Null only if the scenario yields no finite moment.
   */
  nextScheduledMs(): number | null {
    const dayLen = this.scenario.day_length_seconds;
    const ticks: number[] = [
      nextMultiple(this.tick, HALF_DAY),
      nextMultiple(this.tick, this.scenario.reflex.hunger_interval_ticks),
    ];
    const ev = this.scenario.events[this.nextScenarioEvent];
    if (ev) ticks.push(ev.at_tick);
    if (this.current) ticks.push(intentEndTick(this.current));
    const ms = this.startMs + msAt(Math.min(...ticks), dayLen);
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * Plays the world forward to `nowMs`, one step per due moment in tick order. Never goes back; a
   * non-finite `nowMs` is ignored.
   *
   * With a very short day a long jump holds billions of steps. After `MAX_CATCHUP_STEPS` steps
   * without reaching a scenario event or an intent end, the run skips ahead to that moment (or to
   * the target). The skipped stretch is quiet and deterministic: no `day_night` events, no eating,
   * and food falls by the hunger steps it holds (never below 0). Scenario events and intent ends
   * are never skipped.
   */
  syncTo(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const dayLen = this.scenario.day_length_seconds;
    const target = tickAt(nowMs - this.startMs, dayLen);
    let steps = 0;
    while (this.tick < target) {
      if (steps >= MAX_CATCHUP_STEPS) {
        this.skipQuietly(target);
        steps = 0;
        continue;
      }
      const t = this.nextStepTick();
      if (t > target) break;
      this.tick = t;
      this.step(t);
      steps++;
    }
    if (target > this.tick) this.tick = target;
    // A suppressed seq that left the log can never be asked about again.
    const first = this.log.firstSeq();
    for (const seq of this.suppressedSeqs) if (seq < first) this.suppressedSeqs.delete(seq);
  }

  /** Jumps to just before the next event or intent end (or to `target`), counting hunger only. */
  private skipQuietly(target: number): void {
    const ev = this.scenario.events[this.nextScenarioEvent];
    const due = Math.min(
      target,
      ev ? ev.at_tick : Number.POSITIVE_INFINITY,
      this.current ? intentEndTick(this.current) : Number.POSITIVE_INFINITY,
    );
    // Stop one tick short of a due moment so the normal step handles it; the target needs no step.
    const to = due === target ? target : Math.max(this.tick, due - 1);
    const h = this.scenario.reflex.hunger_interval_ticks;
    const steps = Math.floor(to / h) - Math.floor(this.tick / h);
    this.food = Math.max(0, this.food - steps);
    this.tick = to;
  }

  private nextStepTick(): number {
    const c = [
      nextMultiple(this.tick, HALF_DAY),
      nextMultiple(this.tick, this.scenario.reflex.hunger_interval_ticks),
    ];
    const ev = this.scenario.events[this.nextScenarioEvent];
    if (ev) c.push(ev.at_tick);
    if (this.current) c.push(intentEndTick(this.current));
    return Math.min(...c);
  }

  private emit(
    t: number,
    e: Omit<SimEvent, 'seq' | 'tick' | 'atMs' | 'wakeOn'>,
    wakeOn?: string[] | null,
  ): void {
    this.log.append({
      ...e,
      tick: t,
      atMs: this.startMs + msAt(t, this.scenario.day_length_seconds),
      wakeOn: wakeOn === undefined ? this.runningWakeOn() : wakeOn,
    });
  }

  private runningWakeOn(): string[] | null {
    return this.current ? [...this.current.spec.wake_on] : null;
  }

  /** Brings the running intent to tick `t` against the current facts; logs its end. */
  private advanceTo(t: number): void {
    if (!this.current) return;
    const r = advanceIntent(this.current, t, this.facts);
    const wakeOn = [...this.current.spec.wake_on];
    this.current = r.state;
    if (r.finished === null) return;
    this.emit(
      t,
      {
        kind: 'intent_finished',
        outcome: r.finished,
        ...(r.failure ? { failure: r.failure } : {}),
        id: r.state.id,
      },
      wakeOn,
    );
    this.current = null;
    this.intentStartedMs = null;
  }

  private step(t: number): void {
    this.advanceTo(t);
    const events = this.scenario.events;
    for (
      let ev = events[this.nextScenarioEvent];
      ev && ev.at_tick <= t;
      ev = events[this.nextScenarioEvent]
    ) {
      this.nextScenarioEvent++;
      this.applyScenarioEvent(t, ev);
    }
    const tickOfDay = t % DAY;
    if (tickOfDay === 0) this.emit(t, { kind: 'day_night', name: 'dawn' });
    else if (tickOfDay === HALF_DAY) this.emit(t, { kind: 'day_night', name: 'dusk' });
    if (t % this.scenario.reflex.hunger_interval_ticks === 0) {
      this.food = Math.max(0, this.food - 1);
      const r = tryEat(
        { food: this.food, inventory: this.inventory },
        this.scenario.reflex.eat_below,
      );
      if (r.ate) {
        this.food = r.state.food;
        this.inventory = r.state.inventory;
        this.emit(t, { kind: 'reflex', ...(r.item ? { name: r.item } : {}) });
      }
    }
  }

  private applyScenarioEvent(t: number, ev: Scenario['events'][number]): void {
    switch (ev.type) {
      case 'speech':
        this.emit(t, {
          kind: 'speech',
          addressed: ev.to === this.scenario.character.name,
          from: ev.from,
          to: ev.to,
          text: ev.text,
        });
        break;
      case 'damage':
        this.emit(t, { kind: 'damage', amount: ev.amount });
        break;
      case 'agent_approaches':
        this.emit(t, { kind: 'agent_approached', name: ev.name, distance: ev.distance });
        break;
      case 'proposal':
        this.emit(t, { kind: 'proposal', id: ev.id, text: ev.rule });
        break;
      case 'set_fact':
        this.facts.add(ev.fact);
        break;
      case 'clear_fact':
        this.facts.delete(ev.fact);
        this.advanceTo(t);
        break;
    }
  }
}
