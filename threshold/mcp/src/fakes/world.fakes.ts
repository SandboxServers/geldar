import type { BookReply, PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import { buildSnapshot, type SimEvent } from '@geldar/mcp-mock';
import { type BodyGateway, BodyUnavailable, type PlayerEventLog } from '../ports.ts';

/** The rejection a scripted plan answer carries. */
export interface ScriptedRejection {
  reason: NonNullable<PlanAck['rejection']>['reason'];
  detail: string;
}

/** A book the fake Body holds, as its `book` subject would answer it. */
export const NO_BOOK: BookReply = { status: 'no_book', title: '', author: '', text: '' };

/**
 * A scripted Body: answers snapshot, plan and book requests for each life and emits world events
 * into a `PlayerEventLog` on demand. Nothing is simulated; a test decides every answer.
 */
export class FakeBody implements BodyGateway {
  /** Every plan handed over, in order. */
  readonly plans: { lifeId: string; plan: PlanMessage }[] = [];
  /** Every event emitted, in order, whether or not a log took it. */
  readonly emitted: { lifeId: string; event: SimEvent }[] = [];
  private readonly books = new Map<string, BookReply>();
  private readonly offline = new Set<string>();
  private readonly rejections = new Map<string, ScriptedRejection[]>();
  private readonly revisions = new Map<string, number>();
  private snapshotCount = 0;

  /** `log` takes the emitted events; `shard` goes into every snapshot. */
  private readonly log: PlayerEventLog | undefined;
  private readonly shard: string;

  constructor(log?: PlayerEventLog, shard = 'phase0') {
    this.log = log;
    this.shard = shard;
  }

  /** Sets the book a life's Body answers with. */
  setBook(lifeId: string, book: BookReply): void {
    this.books.set(lifeId, book);
  }

  /** Makes a life's Body stop answering (true) or answer again (false). */
  setOffline(lifeId: string, offline: boolean): void {
    if (offline) this.offline.add(lifeId);
    else this.offline.delete(lifeId);
  }

  /** The next plan for this life is refused with this reason; scripted refusals run in order. */
  rejectNextPlan(lifeId: string, rejection: ScriptedRejection): void {
    this.rejections.set(lifeId, [...(this.rejections.get(lifeId) ?? []), rejection]);
  }

  /** Emits a world event for a life: it goes to the log when one is set, and is always recorded. */
  async emit(lifeId: string, event: SimEvent): Promise<void> {
    this.emitted.push({ lifeId, event });
    await this.log?.append(lifeId, event);
  }

  async snapshot(lifeId: string): Promise<Snapshot> {
    this.requireOnline(lifeId);
    const revision = (this.revisions.get(lifeId) ?? 0) + 1;
    this.revisions.set(lifeId, revision);
    this.snapshotCount += 1;
    return buildSnapshot({
      agentId: lifeId,
      shard: this.shard,
      revision,
      snapshotN: this.snapshotCount,
      day: 1,
      ticks: 0,
      timeOfDay: 'day',
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      food: 20,
      inventory: [],
      neighbours: [],
    });
  }

  async submitPlan(lifeId: string, plan: PlanMessage): Promise<PlanAck> {
    this.requireOnline(lifeId);
    this.plans.push({ lifeId, plan });
    const refused = this.rejections.get(lifeId)?.shift();
    return {
      thought_id: plan.thought_id,
      accepted: refused === undefined,
      rejection: refused ?? null,
    };
  }

  async book(lifeId: string): Promise<BookReply> {
    this.requireOnline(lifeId);
    return this.books.get(lifeId) ?? NO_BOOK;
  }

  private requireOnline(lifeId: string): void {
    if (this.offline.has(lifeId))
      throw new BodyUnavailable(`the Body of ${lifeId} does not answer`);
  }
}
