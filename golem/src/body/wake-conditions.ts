import type { RecordSink, ReflexFiredRecord } from './records.ts';
import type { WakeReason, WakeRequest } from './wake.ts';

/** What the Body looked at this tick, for the wake conditions that watch the world. */
export interface WakeSample {
  /** Current health (0 to 20). */
  health: number;
  /** Names of the other agents within `radius` blocks. Empty when the Body cannot tell. */
  agentsWithin(radius: number): string[];
}

/**
 * One intent's `wake_on` set (spec 5.3.1, Appendix C). `watch` covers the conditions the Body sees
 * by looking: `unexpected_damage` (health fell since the last sample) and `new_agent_within_N` (an
 * agent that was not within N blocks at the last sample is now). The event-driven ones
 * (`directly_addressed`, `precondition_failed`, `goal_completed`) are asked with `wants`.
 * Anything not listed in `wake_on` never wakes the Mind from here.
 */
export class WakeConditions {
  private readonly listed: ReadonlySet<string>;
  private readonly radii: number[];
  private lastHealth: number;
  private readonly known = new Map<number, Set<string>>();

  /** `baseline` is the first sample: it sets what "new" and "damage" are measured against. */
  constructor(wakeOn: readonly string[], baseline: WakeSample) {
    this.listed = new Set(wakeOn);
    this.radii = wakeOn
      .map((reason) => /^new_agent_within_([0-9]{1,2})$/.exec(reason)?.[1])
      .filter((digits): digits is string => digits !== undefined)
      .map(Number);
    this.lastHealth = baseline.health;
    for (const radius of this.radii) this.known.set(radius, new Set(baseline.agentsWithin(radius)));
  }

  /** True when `reason` is in the intent's `wake_on`. */
  wants(reason: WakeReason): boolean {
    return this.listed.has(reason);
  }

  /** Looks at the world once. The first wake condition that fires, with a detail, or null. */
  watch(sample: WakeSample): { reason: WakeReason; detail: string } | null {
    let found: { reason: WakeReason; detail: string } | null = null;
    if (this.wants('unexpected_damage') && sample.health < this.lastHealth) {
      found = {
        reason: 'unexpected_damage',
        detail: `health ${this.lastHealth} to ${sample.health}`,
      };
    }
    this.lastHealth = sample.health;
    for (const radius of this.radii) {
      const before = this.known.get(radius) ?? new Set<string>();
      const now = sample.agentsWithin(radius);
      const arrived = now.find((name) => !before.has(name));
      this.known.set(radius, new Set(now));
      if (arrived !== undefined && found === null) {
        found = {
          reason: `new_agent_within_${radius}` as WakeReason,
          detail: `${arrived} came within ${radius} blocks`,
        };
      }
    }
    return found;
  }
}

/**
 * A `RecordSink` that forwards everything to another sink and tells listeners about wakes and
 * reflex firings. The executor learns from it that a reflex raised a wake (so the intent must not
 * resume) without the reflexes knowing the executor exists. Build the runtime with the tap as its
 * sink and give the same tap to the executor.
 */
export class WakeTap implements RecordSink {
  private readonly inner: RecordSink;
  private readonly wakeListeners = new Set<(request: WakeRequest) => void>();
  private readonly reflexListeners = new Set<(record: ReflexFiredRecord) => void>();

  constructor(inner: RecordSink) {
    this.inner = inner;
  }

  /** Calls `listener` on every wake; returns the function that removes it. */
  onWake(listener: (request: WakeRequest) => void): () => void {
    this.wakeListeners.add(listener);
    return () => this.wakeListeners.delete(listener);
  }

  /** Calls `listener` on every reflex firing; returns the function that removes it. */
  onReflexFired(listener: (record: ReflexFiredRecord) => void): () => void {
    this.reflexListeners.add(listener);
    return () => this.reflexListeners.delete(listener);
  }

  intentChanged: RecordSink['intentChanged'] = (change) => this.inner.intentChanged(change);
  actionChanged: RecordSink['actionChanged'] = (record) => this.inner.actionChanged(record);
  receipt: RecordSink['receipt'] = (receipt) => this.inner.receipt(receipt);

  reflexFired(record: ReflexFiredRecord): void {
    this.inner.reflexFired(record);
    for (const listener of [...this.reflexListeners]) listener(record);
  }

  wake(request: WakeRequest): void {
    this.inner.wake(request);
    for (const listener of [...this.wakeListeners]) listener(request);
  }
}
