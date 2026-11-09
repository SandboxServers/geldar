/**
 * The Mind's memory and journal (spec 5.3, 5.4, Appendix D). The row types mirror the columns of
 * `sql/0001_init.sql` (`agents`, `thoughts`, `memories`, `relationships`, `goals`,
 * `suppressed_wakeups`) in camelCase; timestamps are ISO 8601 strings. P0-28 implements the store
 * over Postgres and pgvector; the fakes keep everything in memory. Every method is scoped to one
 * life: a store never returns or changes another life's rows.
 */
import type { Reflection, Snapshot, Thought } from '@geldar/contract';
import type { SuppressionReason } from './attention.ts';
import type { ModelMessage } from './model.ts';

/** How sure a memory is (spec Appendix B.2 `kind`, SQL `memories.provenance`). */
export type Provenance =
  | 'observation'
  | 'report'
  | 'interpretation'
  | 'prediction'
  | 'commitment'
  | 'preference';

/** Row of `agents`: one life. */
export interface AgentRow {
  agentId: string;
  name: string;
  lifeSeq: number;
  gameAccount: string;
  shard: string;
  mode: 'headless' | 'sovereign' | null;
  declaredModel: string | null;
  /** Pinned weights, quantisation, sampling and runtime. */
  modelConfig: string;
  tier: string;
  personalitySeed: string | null;
  bornAt: string | null;
  bornDay: number | null;
  budgetRemaining: number | null;
  budgetDaily: number | null;
  lastSleepDay: number | null;
}

/** Row of `memories`. `embedding` is not read back; searches return rows without it. */
export interface MemoryRow {
  memoryId: number;
  agentId: string;
  /** Episodic (what happened) or semantic (what the agent believes). */
  kind: 'episodic' | 'semantic';
  provenance: Provenance;
  subject: string | null;
  text: string;
  createdDay: number;
  sourceThought: string | null;
  sourceAgent: string | null;
  /** The tick a commitment or prediction falls due, or null. */
  dueTick: number | null;
  resolved: boolean;
  /** False once a belief is deactivated; searches and loads return active rows only. */
  active: boolean;
}

/** A memory to write: a `MemoryRow` without the generated id, life, activity and resolved flags. */
export interface NewMemory {
  kind: MemoryRow['kind'];
  provenance: Provenance;
  subject: string | null;
  text: string;
  createdDay: number;
  sourceThought: string | null;
  sourceAgent: string | null;
  dueTick: number | null;
}

/**
 * Row of `relationships`. `otherId` is the other party's resolved agent id (the SQL foreign key on
 * `other_id` allows nothing else; a Body's game username equals its life id, decisions 0040 and
 * 0051). A reflection's update for a name that resolves to no agent is kept as a semantic memory
 * with the subject `relationship:<name>`, not as a row (overnight decision 40, `PgMemoryStore`).
 */
export interface RelationshipRow {
  agentId: string;
  otherId: string;
  impression: string;
  /** 0 to 100. */
  trust: number;
  lastSeenDay: number | null;
}

/** Row of `goals`: `rank` 0 is the top goal. */
export interface GoalRow {
  agentId: string;
  rank: number;
  goal: string;
  why: string;
}

/** What the Mind loads for every thought without searching (spec 5.3.4). */
export interface DeterministicMemory {
  agent: AgentRow;
  goals: GoalRow[];
  relationships: RelationshipRow[];
  /** Active semantic memories (beliefs), newest first. */
  beliefs: MemoryRow[];
  /** Active, unresolved memories whose `dueTick` is at or before the tick asked for, oldest first. */
  dueCommitments: MemoryRow[];
}

/** Row of `thoughts`: one model call and its outcome. */
export interface ThoughtRow {
  thoughtId: string;
  lifeId: string;
  at: string;
  worldDay: number;
  worldTick: number;
  wakeReason: string;
  /** The snapshot the thought was made from. */
  snapshot: Snapshot | null;
  /** The complete messages array sent, not a hash. */
  modelInput: ModelMessage[] | null;
  promptTemplateVersion: string;
  schemaVersion: string;
  mindVersion: string;
  bodyVersion: string;
  modelConfig: string;
  thinkerId: string | null;
  effort: string;
  tokensInEstimated: number | null;
  tokensOutEstimated: number | null;
  /** Provider-reported usage with its provenance, when available. */
  providerUsage: Record<string, unknown> | null;
  rawOutput: string | null;
  /**
   * The validated thought, or for a reflection row (wakeReason reflection) the validated
   * reflection; null when the output was rejected.
   */
  parsed: Thought | Reflection | null;
  latencyMs: number | null;
  creditsReserved: number | null;
  creditsSettled: number | null;
}

/** Row of `suppressed_wakeups`: an event the controller chose not to escalate. */
export interface SuppressedWakeup {
  lifeId: string;
  at: string;
  eventTypes: string[];
  reason: SuppressionReason;
  intentId: string | null;
}

/** The part of a thought the prompts read back: what the agent decided and when. */
export interface JournalEntry {
  thoughtId: string;
  worldDay: number;
  worldTick: number;
  wakeReason: string;
  /** The validated thought, or null when the output was rejected. */
  parsed: Thought | null;
}

/** The durable memory of one or more lives. */
export interface MemoryStore {
  /** Inserts the life's `agents` row when it is not there; leaves an existing row unchanged. */
  ensureAgent(agent: AgentRow): Promise<void>;
  /** Loads the goals, relationships, beliefs and due commitments of `lifeId` as of `nowTick`. */
  loadDeterministic(lifeId: string, nowTick: number): Promise<DeterministicMemory>;
  /** The `topK` active episodic memories nearest to `embedding` by cosine distance, nearest first. */
  searchEpisodic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]>;
  /** The `topK` active semantic memories nearest to `embedding` by cosine distance, nearest first. */
  searchSemantic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]>;
  /**
   * Writes memories with their embeddings (one per memory, in order) and returns the new ids in
   * order. Fails, writing nothing, when the counts differ or an embedding is not 768 numbers.
   */
  writeMemories(lifeId: string, memories: NewMemory[], embeddings: number[][]): Promise<number[]>;
  /**
   * Like `writeMemories`, but an embedding may be null (the embedder was down): the row is kept
   * without a vector until `backfillEmbeddings` fills it in. Fails, writing nothing, when the
   * counts differ or a non-null embedding is not 768 numbers.
   */
  writeMemoriesPartial(
    lifeId: string,
    memories: NewMemory[],
    embeddings: (number[] | null)[],
  ): Promise<number[]>;
  /**
   * Embeds up to `limit` active memories that have no vector yet (oldest first) and stores the
   * vectors; returns how many were filled. Needs the store's embedder; rejects when it fails.
   */
  backfillEmbeddings(limit: number): Promise<number>;
  /** Marks one of the life's commitments resolved; returns whether a row changed. */
  resolveCommitment(lifeId: string, memoryId: number): Promise<boolean>;
  /** Marks the active beliefs whose text equals one of `beliefs` as inactive; returns how many. */
  deactivateBeliefs(lifeId: string, beliefs: string[]): Promise<number>;
  /** Inserts or updates one row per update, keyed by (life, other party). */
  upsertRelationships(
    lifeId: string,
    updates: Reflection['relationship_updates'],
    day: number,
  ): Promise<void>;
  /** Replaces all of the life's goals; the first is rank 0. An empty list clears them. */
  replaceGoals(lifeId: string, goals: Reflection['goals']): Promise<void>;
  /** Records the world day of the life's last completed sleep. */
  setLastSleepDay(lifeId: string, day: number): Promise<void>;
}

/** The record of thoughts and suppressed wakes. */
export interface Journal {
  /** Stores one thought row; storing the same `thoughtId` again replaces it. */
  recordThought(row: ThoughtRow): Promise<void>;
  /** Stores one suppressed wake. */
  recordSuppressed(row: SuppressedWakeup): Promise<void>;
  /**
   * Sets `thought_id` on the intent row `intentId` when that column is still null; returns whether
   * a row changed. The event sink writes the intent row, so it may not exist yet: false then, and
   * the caller tries again.
   */
  linkIntent(intentId: string, thoughtId: string): Promise<boolean>;
  /**
   * The life's thoughts with `worldTick` at or after `tick`, oldest first. With `limit`, only
   * the newest `limit` of them (still oldest first).
   */
  journalSince(lifeId: string, tick: number, limit?: number): Promise<JournalEntry[]>;
}

/** Turns text into vectors (decision D-P0-12: `nomic-embed-text`, 768 dimensions). */
export interface Embedder {
  /** The vector length; 768 in Phase 0. */
  readonly dims: number;
  /**
   * One vector per text, in order. `document` is for text to be stored, `query` for text to search
   * with; the implementation adds the model's task prefix itself.
   */
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}
