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
  RelationshipRow,
  SuppressedWakeup,
  ThoughtRow,
} from '../ports/index.ts';

/** The embedding size of `nomic-embed-text` (decision D-P0-12). */
const DIMS = 768;

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
        .filter((m) => !m.resolved && m.dueTick !== null && m.dueTick <= nowTick)
        .sort((a, b) => (a.dueTick ?? 0) - (b.dueTick ?? 0)),
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
      throw new Error(` memories but ${embeddings.length} embeddings`);
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

  async upsertRelationships(
    lifeId: string,
    updates: { name: string; impression: string; trust: number }[],
    day: number,
  ): Promise<void> {
    for (const update of updates) {
      this.relationships.set(`${lifeId}|${update.name}`, {
        agentId: lifeId,
        otherId: update.name,
        impression: update.impression,
        trust: update.trust,
        lastSeenDay: day,
      });
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

  async recordThought(row: ThoughtRow): Promise<void> {
    const at = this.thoughts.findIndex((t) => t.thoughtId === row.thoughtId);
    if (at >= 0) this.thoughts[at] = row;
    else this.thoughts.push(row);
  }

  async recordSuppressed(row: SuppressedWakeup): Promise<void> {
    this.suppressed.push(row);
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
