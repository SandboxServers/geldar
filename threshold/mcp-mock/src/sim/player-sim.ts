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
  /** The facts that hold now. */
  readonly facts: Set<string>;
  /** Food level, 0 to 20. */
  food: number;
  inventory: ReflexStack[];
  /** Thoughts left. */
  budget: number;
  /** When the model last woke, or null. */
  lastWakeMs: number | null = null;
  /** Seqs recorded as suppressed wakes. */
  readonly suppressedSeqs: Set<number> = new Set();
  /** The tick reached by the last `syncTo`. */
  tick = 0;
  /** The private ledger of `ac_` and `in_` ids. No tool result carries it. */
  readonly receipts: string[] = [];
  /** The clock time the running intent started, or null. */
  intentStartedMs: number | null = null;
  private current: IntentState | null = null;
  private nextScenarioEvent = 0;

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
    const id = this.nextId('in');
    const r = startIntent(spec, this.tick, this.scenario.intent.default_ticks, this.facts, id);
    if (r.ok) {
      this.current = r.state;
      this.intentStartedMs = nowMs;
      this.receipts.push(id);
    }
    return r;
  }

  /** Drops the running intent without an event. */
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

  /** Plays the world forward to `nowMs`, one step per due moment in tick order. Never goes back. */
  syncTo(nowMs: number): void {
    const dayLen = this.scenario.day_length_seconds;
    const target = tickAt(nowMs - this.startMs, dayLen);
    while (this.tick < target) {
      const t = this.nextStepTick();
      if (t > target) break;
      this.tick = t;
      this.step(t);
    }
    if (target > this.tick) this.tick = target;
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
