import { createHash } from 'node:crypto';
import type { Thought } from '@geldar/contract';
import type {
  AgentRow,
  DeterministicMemory,
  Embedder,
  GoalRow,
  Journal,
  JournalEntry,
  MemoryRow,
  MemoryStore,
  NewMemory,
  ReflectionWrites,
  RelationshipRow,
  SuppressedWakeup,
  ThoughtRow,
} from '../ports/index.ts';

/** The embedding size of `nomic-embed-text` (decision D-P0-12). */
const DIMS = 768;

/** The life the loop and reflection fixtures use; `addIntentRow` defaults to it. */
const FIXTURE_LIFE = 'ag_adam_01';

/**
 * An `Embedder` that needs no model: the vector is a pure function of the text and the kind,
 * made from a SHA-256 hash and scaled to unit length. Equal inputs give equal vectors; different
 * texts give different ones. It has no meaning beyond that, so a similarity search over it is
 * stable but not semantic.
 */
export class FakeEmbedder implements Embedder {
  readonly dims = DIMS;

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    return texts.map((text) => this.vector(`${kind}:${text}`));
  }

  private vector(seed: string): number[] {
    const values: number[] = [];
    for (let block = 0; values.length < DIMS; block++) {
      const hash = createHash('sha256').update(`${block}:${seed}`).digest();
      for (let i = 0; i + 1 < hash.length && values.length < DIMS; i += 2) {
        values.push(hash.readUInt16BE(i) / 32768 - 1);
      }
    }
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
    return values.map((v) => v / norm);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Replaces the entries of `target` with those of `source`. */
function refill<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

interface StoredMemory {
  row: MemoryRow;
  /** Null until written or backfilled; a memory without a vector is not found by a search. */
  embedding: number[] | null;
}

/**
 * An in-memory `MemoryStore` and `Journal`. It follows the port's documented rules (scoped by life,
 * active rows only, nearest first) and checks the same preconditions the Postgres store will.
 */
export class FakeMemoryStore implements MemoryStore, Journal {
  readonly agents = new Map<string, AgentRow>();
  readonly thoughts: ThoughtRow[] = [];
  readonly suppressed: SuppressedWakeup[] = [];
  /** The `intents` rows by id: their life and `thought_id` (no key: no row yet). */
  private readonly intentRows = new Map<string, { lifeId: string; thoughtId: string | null }>();
  private readonly memories: StoredMemory[] = [];
  private readonly relationships = new Map<string, RelationshipRow>();
  private readonly goals = new Map<string, GoalRow[]>();
  private nextMemoryId = 1;
  private readonly embedder: Embedder | undefined;

  /** The embedder is needed only by `backfillEmbeddings`. */
  constructor(embedder?: Embedder) {
    this.embedder = embedder;
  }

  async ensureAgent(agent: AgentRow): Promise<void> {
    if (!this.agents.has(agent.agentId)) this.agents.set(agent.agentId, { ...agent });
  }

  async loadDeterministic(lifeId: string, nowTick: number): Promise<DeterministicMemory> {
    const agent = this.agents.get(lifeId);
    if (agent === undefined) throw new Error(`no agent ${lifeId}`);
    const active = this.activeRows(lifeId);
    return {
      agent: { ...agent },
      goals: [...(this.goals.get(lifeId) ?? [])].sort((a, b) => a.rank - b.rank),
      relationships: [...this.relationships.values()].filter((r) => r.agentId === lifeId),
      beliefs: active.filter((m) => m.kind === 'semantic').reverse(),
      dueCommitments: active
        .filter(
          (m) =>
            m.provenance === 'commitment' &&
            !m.resolved &&
            (m.dueTick === null || m.dueTick <= nowTick),
        )
        .sort((a, b) => (a.dueTick ?? -1) - (b.dueTick ?? -1)),
    };
  }

  async searchEpisodic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]> {
    return this.search(lifeId, 'episodic', embedding, topK);
  }

  async searchSemantic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]> {
    return this.search(lifeId, 'semantic', embedding, topK);
  }

  async writeMemories(
    lifeId: string,
    memories: NewMemory[],
    embeddings: number[][],
  ): Promise<number[]> {
    if (memories.length !== embeddings.length) {
      throw new Error(`${memories.length} memories but ${embeddings.length} embeddings`);
    }
    return this.writeMemoriesPartial(lifeId, memories, embeddings);
  }

  async writeMemoriesPartial(
    lifeId: string,
    memories: NewMemory[],
    embeddings: (number[] | null)[],
  ): Promise<number[]> {
    if (memories.length !== embeddings.length) {
      throw new Error(`${memories.length} memories but ${embeddings.length} embeddings`);
    }
    if (embeddings.some((e) => e !== null && e.length !== DIMS)) {
      throw new Error(`every embedding must have ${DIMS} numbers`);
    }
    return memories.map((memory, i) => {
      const memoryId = this.nextMemoryId++;
      const row: MemoryRow = {
        ...memory,
        memoryId,
        agentId: lifeId,
        resolved: false,
        active: true,
      };
      this.memories.push({ row, embedding: embeddings[i] ?? null });
      return memoryId;
    });
  }

  async backfillEmbeddings(limit: number): Promise<number> {
    if (this.embedder === undefined) throw new Error('backfillEmbeddings needs an embedder');
    const pending = this.memories
      .filter((m) => m.row.active && m.embedding === null)
      .slice(0, limit);
    if (pending.length === 0) return 0;
    const vectors = await this.embedder.embed(
      pending.map((m) => m.row.text),
      'document',
    );
    for (const [i, m] of pending.entries()) m.embedding = vectors[i] ?? null;
    return pending.length;
  }

  async resolveCommitment(lifeId: string, memoryId: number): Promise<boolean> {
    const found = this.memories.find(
      (m) =>
        m.row.agentId === lifeId &&
        m.row.memoryId === memoryId &&
        m.row.provenance === 'commitment' &&
        !m.row.resolved,
    );
    if (found === undefined) return false;
    found.row.resolved = true;
    return true;
  }

  async deactivateBeliefs(lifeId: string, beliefs: string[]): Promise<number> {
    let count = 0;
    for (const { row } of this.memories) {
      if (
        row.agentId === lifeId &&
        row.kind === 'semantic' &&
        row.active &&
        beliefs.includes(row.text)
      ) {
        row.active = false;
        count++;
      }
    }
    return count;
  }

  /** As `PgMemoryStore`: a name that resolves to another life's agent row gets a relationship row. */
  async upsertRelationships(
    lifeId: string,
    updates: { name: string; impression: string; trust: number }[],
    day: number,
  ): Promise<void> {
    for (const update of updates) {
      const otherId = this.resolveAgent(update.name, lifeId);
      if (otherId !== undefined) {
        this.relationships.set(`${lifeId}|${otherId}`, {
          agentId: lifeId,
          otherId,
          impression: update.impression,
          trust: update.trust,
          lastSeenDay: day,
        });
        continue;
      }
      const subject = `relationship:${update.name}`;
      for (const { row } of this.memories) {
        if (row.agentId === lifeId && row.active && row.subject === subject) row.active = false;
      }
      const text = `${update.name}: ${update.impression} (trust ${update.trust})`;
      const vector =
        this.embedder === undefined ? null : await this.embedder.embed([text], 'document');
      await this.writeMemoriesPartial(
        lifeId,
        [
          {
            kind: 'semantic',
            provenance: 'interpretation',
            subject,
            text,
            createdDay: day,
            sourceThought: null,
            sourceAgent: null,
            dueTick: null,
          },
        ],
        [vector?.[0] ?? null],
      );
    }
  }

  async replaceGoals(lifeId: string, goals: { goal: string; why: string }[]): Promise<void> {
    this.goals.set(
      lifeId,
      goals.map((g, rank) => ({ agentId: lifeId, rank, goal: g.goal, why: g.why })),
    );
  }

  async setLastSleepDay(lifeId: string, day: number): Promise<void> {
    const agent = this.agents.get(lifeId);
    if (agent === undefined) throw new Error(`no agent ${lifeId}`);
    agent.lastSleepDay = day;
  }

  /**
   * Runs the same steps as `PgMemoryStore.commitReflection`. A step that throws restores every
   * table to its state before the call, as the rolled-back transaction would.
   */
  async commitReflection(lifeId: string, writes: ReflectionWrites): Promise<number> {
    const restore = this.snapshot();
    try {
      await this.writeMemoriesPartial(lifeId, writes.memories, writes.embeddings);
      for (const memoryId of writes.resolve) await this.resolveCommitment(lifeId, memoryId);
      const retired = await this.deactivateBeliefs(lifeId, writes.deactivate);
      await this.upsertRelationships(lifeId, writes.relationships, writes.day);
      if (writes.goals !== null) await this.replaceGoals(lifeId, writes.goals);
      await this.setLastSleepDay(lifeId, writes.day);
      return retired;
    } catch (error) {
      restore();
      throw error;
    }
  }

  /** Stores a thought; a row of another life with the same id is left as it was (as the upsert does). */
  async recordThought(row: ThoughtRow): Promise<void> {
    const at = this.thoughts.findIndex((t) => t.thoughtId === row.thoughtId);
    if (at < 0) this.thoughts.push(row);
    else if (this.thoughts[at]?.lifeId === row.lifeId) this.thoughts[at] = row;
  }

  async recordSuppressed(row: SuppressedWakeup): Promise<void> {
    this.suppressed.push(row);
  }

  /**
   * Adds an `intents` row as the event sink would; `thoughtId` null means the column is empty.
   * The row belongs to `lifeId` (the fixtures' life when none is given).
   */
  addIntentRow(intentId: string, thoughtId: string | null = null, lifeId = FIXTURE_LIFE): void {
    this.intentRows.set(intentId, { lifeId, thoughtId });
  }

  /** The `thought_id` of an `intents` row: undefined when there is no row. */
  intentThought(intentId: string): string | null | undefined {
    return this.intentRows.get(intentId)?.thoughtId;
  }

  /** As the Postgres store: only a row of `lifeId` is linked, and only while its column is empty. */
  async linkIntent(lifeId: string, intentId: string, thoughtId: string): Promise<boolean> {
    const row = this.intentRows.get(intentId);
    if (row === undefined || row.lifeId !== lifeId) return false;
    if (row.thoughtId === thoughtId) return true;
    if (row.thoughtId !== null) return false;
    row.thoughtId = thoughtId;
    return true;
  }

  async lastReflectionTick(lifeId: string): Promise<number> {
    const ticks = this.thoughts
      .filter((t) => t.lifeId === lifeId && t.wakeReason === 'reflection')
      .map((t) => t.worldTick);
    return ticks.length === 0 ? 0 : Math.max(...ticks);
  }

  async journalSince(lifeId: string, tick: number, limit?: number): Promise<JournalEntry[]> {
    const all = this.thoughts
      .filter((t) => t.lifeId === lifeId && t.worldTick >= tick)
      .sort((a, b) => a.worldTick - b.worldTick);
    return (limit === undefined ? all : all.slice(-limit)).map((t) => ({
      thoughtId: t.thoughtId,
      worldDay: t.worldDay,
      worldTick: t.worldTick,
      wakeReason: t.wakeReason,
      parsed: t.wakeReason === 'reflection' ? null : (t.parsed as Thought | null),
    }));
  }

  /** The agent a name resolves to: by `name` or `game_account`, the latest life first. */
  private resolveAgent(name: string, lifeId: string): string | undefined {
    const found = [...this.agents.values()]
      .filter((a) => a.agentId !== lifeId && (a.name === name || a.gameAccount === name))
      .sort((a, b) => b.lifeSeq - a.lifeSeq)[0];
    return found?.agentId;
  }

  /** Copies the tables; the returned function puts the copies back. */
  private snapshot(): () => void {
    const memories = this.memories.map((m) => ({ row: { ...m.row }, embedding: m.embedding }));
    const agents = new Map([...this.agents].map(([id, a]) => [id, { ...a }] as const));
    const relationships = new Map(this.relationships);
    const goals = new Map(this.goals);
    const nextMemoryId = this.nextMemoryId;
    return () => {
      this.memories.splice(0, this.memories.length, ...memories);
      refill(this.agents, agents);
      refill(this.relationships, relationships);
      refill(this.goals, goals);
      this.nextMemoryId = nextMemoryId;
    };
  }

  private activeRows(lifeId: string): MemoryRow[] {
    return this.memories.filter((m) => m.row.agentId === lifeId && m.row.active).map((m) => m.row);
  }

  private search(
    lifeId: string,
    kind: MemoryRow['kind'],
    embedding: number[],
    topK: number,
  ): MemoryRow[] {
    return this.memories
      .filter((m) => m.row.agentId === lifeId && m.row.kind === kind && m.row.active)
      .flatMap((m) =>
        m.embedding === null ? [] : [{ row: m.row, score: cosine(m.embedding, embedding) }],
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((m) => m.row);
  }
}
