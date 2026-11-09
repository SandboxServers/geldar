import { createHash } from 'node:crypto';
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
  embedding: number[];
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
    if (embeddings.some((e) => e.length !== DIMS)) {
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
      this.memories.push({ row, embedding: embeddings[i] ?? [] });
      return memoryId;
    });
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

  async journalSince(lifeId: string, tick: number): Promise<JournalEntry[]> {
    return this.thoughts
      .filter((t) => t.lifeId === lifeId && t.worldTick >= tick)
      .sort((a, b) => a.worldTick - b.worldTick)
      .map((t) => ({
        thoughtId: t.thoughtId,
        worldDay: t.worldDay,
        worldTick: t.worldTick,
        wakeReason: t.wakeReason,
        parsed: t.parsed,
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
      .map((m) => ({ row: m.row, score: cosine(m.embedding, embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((m) => m.row);
  }
}
