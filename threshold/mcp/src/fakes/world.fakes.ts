import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import type { BookReply, PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import { buildSnapshot, FakeClock, type SimEvent, type WakeConfig } from '@geldar/mcp-mock';
import type { RunState } from '../events/mapper.ts';
import {
  type BodyGateway,
  BodyUnavailable,
  type PlayerEventLog,
  type PlayerRecord,
} from '../ports.ts';
import { KvPresenceStore, type PresenceBucket } from '../presence.ts';
import type { WorldDeps } from '../world.ts';
import {
  FakeBudgetLedger,
  FakeJournalStore,
  FakePlayerDirectory,
  FakePlayerEventLog,
  RecordingCallRecorder,
  ScriptedRateLimiter,
} from './stores.fakes.ts';

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

  /** A fixed picture; a life whose Body is offline cannot draw one. */
  async see(
    lifeId: string,
    _size: { width?: number; height?: number },
  ): Promise<{ png: string } | { error: 'view_unavailable'; detail: string }> {
    this.requireOnline(lifeId);
    return {
      png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    };
  }

  async view(lifeId: string): Promise<{ text: string } | { error: 'unavailable' }> {
    this.requireOnline(lifeId);
    return { text: 'Open ground to the north; a wall of stone three blocks east.' };
  }

  private requireOnline(lifeId: string): void {
    if (this.offline.has(lifeId))
      throw new BodyUnavailable(`the Body of ${lifeId} does not answer`);
  }
}

/**
 * An in-memory KV bucket for the presence store, with NATS KV's revisions: every write takes the
 * next revision, and `update` refuses a key that is no longer at the revision it is given.
 * `puts` keeps every write, in order.
 */
export class MemoryPresenceBucket implements PresenceBucket {
  readonly values = new Map<string, string>();
  readonly puts: { key: string; value: string }[] = [];
  private readonly revisions = new Map<string, number>();
  private lastRevision = 0;

  async get(key: string): Promise<{ string(): string; revision: number } | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    const revision = this.revisions.get(key) ?? 0;
    return { string: () => value, revision };
  }

  async put(key: string, value: string): Promise<number> {
    return this.store(key, value);
  }

  async keys(): Promise<AsyncIterable<string>> {
    const snapshot = [...this.values.keys()];
    return (async function* () {
      yield* snapshot;
    })();
  }

  async update(key: string, value: string, revision: number): Promise<number> {
    if ((this.revisions.get(key) ?? 0) !== revision) {
      throw new Error(`wrong last revision for ${key}`);
    }
    return this.store(key, value);
  }

  private store(key: string, value: string): number {
    this.values.set(key, value);
    this.puts.push({ key, value });
    this.lastRevision++;
    this.revisions.set(key, this.lastRevision);
    return this.lastRevision;
  }
}

/** The fakes behind a `WorldDeps`, kept by name so a test can seed and inspect them. */
export interface WorldFixture {
  deps: WorldDeps;
  clock: FakeClock;
  bucket: MemoryPresenceBucket;
  players: FakePlayerDirectory;
  body: FakeBody;
  budget: FakeBudgetLedger;
  journal: FakeJournalStore;
  recorder: RecordingCallRecorder;
  events: FakePlayerEventLog;
  limiter: ScriptedRateLimiter;
}

/**
 * A world over fakes: a real `KvPresenceStore` on an in-memory bucket, all on one `FakeClock` that
 * starts at 1,000,000 ms. The players given are the directory; budgets are seeded by the caller.
 */
export function worldFixture(players: PlayerRecord[]): WorldFixture {
  const clock = new FakeClock(1_000_000);
  const bucket = new MemoryPresenceBucket();
  const presence = new KvPresenceStore(bucket, () => clock.nowMs());
  const directory = new FakePlayerDirectory();
  for (const player of players) directory.add(player);
  const events = new FakePlayerEventLog();
  const body = new FakeBody(events);
  const budget = new FakeBudgetLedger(0, 100);
  const journal = new FakeJournalStore();
  const recorder = new RecordingCallRecorder();
  const limiter = new ScriptedRateLimiter();
  const wake: WakeConfig = { minSpacingMs: 5_000, intentRunTooLongMs: 600_000 };
  const deps: WorldDeps = {
    players: directory,
    body,
    budget,
    sleeps: { read: async () => ({ lastSleepDay: 1, cursor: 0 }), write: async () => {} },
    deaths: { read: async () => ({ deaths: 0, lastDeathDay: null }), recordDeath: async () => {} },
    profiles: { profile: async () => ({ personality_seed: 'calm and curious', born_day: 0 }) },
    journal,
    recorder,
    events,
    presence,
    limiter,
    validator: createOutputValidator(),
    clock,
    runs: new Map<string, RunState>(),
    wake,
    expiresAfterTicks: 200,
    laws: [],
  };
  return {
    deps,
    clock,
    bucket,
    players: directory,
    body,
    budget,
    journal,
    recorder,
    events,
    limiter,
  };
}
