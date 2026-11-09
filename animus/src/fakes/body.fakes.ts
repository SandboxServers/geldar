import type { PlanAck, PlanMessage, Snapshot, WorldEvent } from '@geldar/contract';
import type {
  BodyLink,
  BodyLinkError,
  EventPublisher,
  EventSource,
  MindEvent,
} from '../ports/index.ts';

/** What a `FakeBodyLink` answers a snapshot request with: a fixed snapshot or a function of the reason. */
export type SnapshotScript = Snapshot | ((reason: string) => Snapshot);

/** How a `FakeBodyLink` answers a plan: a fixed ack, or a function of the plan. */
export type AckScript = PlanAck | ((plan: PlanMessage) => PlanAck);

/** The ack for an accepted plan. */
export function acceptedAck(thoughtId: string): PlanAck {
  return { thought_id: thoughtId, accepted: true, rejection: null };
}

/**
 * A `BodyLink` that returns what it is told to and records the calls. The default ack accepts
 * every plan. `failWith` makes the next calls reject with that `BodyLinkError`.
 */
export class FakeBodyLink implements BodyLink {
  /** Every reason passed to `requestSnapshot`, in order. */
  readonly snapshotRequests: string[] = [];
  /** Every plan passed to `submitPlan`, in order. */
  readonly plans: PlanMessage[] = [];
  failWith: BodyLinkError | undefined;

  private readonly snapshot: SnapshotScript;
  private readonly ack: AckScript | undefined;

  constructor(snapshot: SnapshotScript, ack?: AckScript) {
    this.snapshot = snapshot;
    this.ack = ack;
  }

  async requestSnapshot(reason: string): Promise<Snapshot> {
    this.snapshotRequests.push(reason);
    if (this.failWith !== undefined) throw this.failWith;
    return typeof this.snapshot === 'function' ? this.snapshot(reason) : this.snapshot;
  }

  async submitPlan(plan: PlanMessage): Promise<PlanAck> {
    this.plans.push(plan);
    if (this.failWith !== undefined) throw this.failWith;
    if (this.ack === undefined) return acceptedAck(plan.thought_id);
    return typeof this.ack === 'function' ? this.ack(plan) : this.ack;
  }
}

/** An `EventSource` a test drives by hand with `emit`. */
export class FakeEventSource implements EventSource {
  private readonly handlers = new Map<string, Set<(event: MindEvent) => void>>();

  subscribe(lifeId: string, handler: (event: MindEvent) => void): () => void {
    const set = this.handlers.get(lifeId) ?? new Set();
    set.add(handler);
    this.handlers.set(lifeId, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Delivers `event` to the handlers subscribed to its life, in subscription order. */
  emit(event: MindEvent): void {
    for (const handler of [...(this.handlers.get(event.lifeId) ?? [])]) handler(event);
  }

  /** How many handlers are subscribed to `lifeId` now. */
  subscriberCount(lifeId: string): number {
    return this.handlers.get(lifeId)?.size ?? 0;
  }
}

/** An `EventPublisher` that keeps what it is given. */
export class FakeEventPublisher implements EventPublisher {
  readonly published: WorldEvent[] = [];

  async publish(event: WorldEvent): Promise<void> {
    this.published.push(event);
  }
}
