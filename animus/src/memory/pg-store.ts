import pg from 'pg';
import { type AnimusConfig, readPostgresPassword } from '../config.ts';
import type {
  AgentRow,
  DeterministicMemory,
  Embedder,
  GoalRow,
  MemoryRow,
  MemoryStore,
  NewMemory,
  ReflectionWrites,
  RelationshipRow,
} from '../ports/index.ts';
import { EMBEDDING_DIMS, toVectorLiteral } from './vector.ts';

/** The result of one statement. */
export interface SqlResult {
  // biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped; every row is mapped below.
  rows: any[];
  rowCount: number | null;
}

/** A connection that runs one parameterised statement. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
}

/** What the stores need of a `pg` pool: statements, and a connection for a transaction. */
export interface PgPool extends SqlClient {
  connect(): Promise<SqlClient & { release(): void }>;
}

/** The pool's settings: every wait is bounded, so a stuck Postgres cannot hang the Mind. */
export function poolConfig(config: AnimusConfig, password: string): pg.PoolConfig {
  return {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    database: config.postgres.database,
    password,
    max: 4,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    idleTimeoutMillis: 60_000,
  };
}

/** Opens a pool to the Postgres of the config; the password is read from its secret file. */
export async function openPool(config: AnimusConfig): Promise<pg.Pool> {
  const pool = new pg.Pool(poolConfig(config, await readPostgresPassword(config)));
  // An idle client dropping (a Postgres restart) must not crash the Mind; the next query reconnects.
  pool.on('error', (error) => console.error('animus: idle postgres client error', error));
  return pool;
}

/** Runs `work` in one transaction: it commits when `work` returns and rolls back when it throws. */
export async function inTransaction<T>(
  pool: PgPool,
  work: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const MEMORY_COLUMNS =
  'memory_id, agent_id, kind, provenance, subject, text, created_day, source_thought, ' +
  'source_agent, due_tick, COALESCE(resolved, false) AS resolved, COALESCE(active, true) AS active';

// biome-ignore lint/suspicious/noExplicitAny: a pg row.
function memoryRow(r: any): MemoryRow {
  return {
    memoryId: Number(r.memory_id),
    agentId: r.agent_id,
    kind: r.kind,
    provenance: r.provenance,
    subject: r.subject,
    text: r.text,
    createdDay: Number(r.created_day),
    sourceThought: r.source_thought,
    sourceAgent: r.source_agent,
    dueTick: r.due_tick === null ? null : Number(r.due_tick),
    resolved: r.resolved,
    active: r.active,
  };
}

const optionalNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// biome-ignore lint/suspicious/noExplicitAny: a pg row.
function agentRow(r: any): AgentRow {
  return {
    agentId: r.agent_id,
    name: r.name,
    lifeSeq: Number(r.life_seq),
    gameAccount: r.game_account,
    shard: r.shard,
    mode: r.mode,
    declaredModel: r.declared_model,
    modelConfig: r.model_config,
    tier: r.tier,
    personalitySeed: r.personality_seed,
    bornAt: r.born_at === null ? null : new Date(r.born_at).toISOString(),
    bornDay: optionalNumber(r.born_day),
    budgetRemaining: optionalNumber(r.budget_remaining),
    budgetDaily: optionalNumber(r.budget_daily),
    lastSleepDay: optionalNumber(r.last_sleep_day),
  };
}

/** Options of `PgMemoryStore`. */
export interface PgMemoryStoreOptions {
  /** Embeds relationship memories on write and backfills missing vectors. */
  embedder?: Embedder;
  /** The newest active beliefs `loadDeterministic` returns (`mind.max_beliefs`). */
  maxBeliefs?: number;
}

/**
 * The `MemoryStore` over Postgres and pgvector (spec 5.4). Every statement is parameterised and
 * scoped to one life; nothing is deleted (a belief is deactivated, a commitment is resolved).
 */
export class PgMemoryStore implements MemoryStore {
  private readonly pool: PgPool;
  private readonly embedder: Embedder | undefined;
  private readonly maxBeliefs: number;

  constructor(pool: PgPool, options: PgMemoryStoreOptions = {}) {
    this.pool = pool;
    this.embedder = options.embedder;
    this.maxBeliefs = options.maxBeliefs ?? 40;
  }

  async ensureAgent(agent: AgentRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, declared_model,
         model_config, tier, personality_seed, born_at, born_day, budget_remaining, budget_daily,
         last_sleep_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING`,
      [
        agent.agentId,
        agent.name,
        agent.lifeSeq,
        agent.gameAccount,
        agent.shard,
        agent.mode ?? 'headless',
        agent.declaredModel,
        agent.modelConfig,
        agent.tier,
        agent.personalitySeed,
        agent.bornAt,
        agent.bornDay,
        agent.budgetRemaining,
        agent.budgetDaily,
        agent.lastSleepDay,
      ],
    );
  }

  async loadDeterministic(lifeId: string, nowTick: number): Promise<DeterministicMemory> {
    const agent = await this.pool.query('SELECT * FROM agents WHERE agent_id = $1', [lifeId]);
    if (agent.rows[0] === undefined) throw new Error(`no agent ${lifeId}`);
    const [goals, relationships, beliefs, due] = await Promise.all([
      this.pool.query(
        'SELECT agent_id, rank, goal, why FROM goals WHERE agent_id = $1 ORDER BY rank',
        [lifeId],
      ),
      this.pool.query(
        `SELECT agent_id, other_id, impression, trust, last_seen_day FROM relationships
         WHERE agent_id = $1 ORDER BY last_seen_day DESC NULLS LAST, other_id`,
        [lifeId],
      ),
      this.pool.query(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE agent_id = $1 AND kind = 'semantic' AND COALESCE(active, true)
         ORDER BY memory_id DESC LIMIT $2`,
        [lifeId, this.maxBeliefs],
      ),
      this.pool.query(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE agent_id = $1 AND provenance = 'commitment' AND COALESCE(active, true)
           AND NOT COALESCE(resolved, false) AND (due_tick IS NULL OR due_tick <= $2)
         ORDER BY due_tick NULLS FIRST, memory_id`,
        [lifeId, nowTick],
      ),
    ]);
    return {
      agent: agentRow(agent.rows[0]),
      goals: goals.rows.map(
        (r): GoalRow => ({ agentId: r.agent_id, rank: Number(r.rank), goal: r.goal, why: r.why }),
      ),
      relationships: relationships.rows.map(
        (r): RelationshipRow => ({
          agentId: r.agent_id,
          otherId: r.other_id,
          impression: r.impression,
          trust: Number(r.trust),
          lastSeenDay: optionalNumber(r.last_seen_day),
        }),
      ),
      beliefs: beliefs.rows.map(memoryRow),
      dueCommitments: due.rows.map(memoryRow),
    };
  }

  searchEpisodic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]> {
    return this.search(lifeId, 'episodic', embedding, topK);
  }

  searchSemantic(lifeId: string, embedding: number[], topK: number): Promise<MemoryRow[]> {
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

  /**
   * Like `writeMemories`, but an embedding may be null (the embedder was down): the row is stored
   * without a vector and `backfillEmbeddings` fills it in later. Nothing is written when a
   * non-null embedding is malformed.
   */
  async writeMemoriesPartial(
    lifeId: string,
    memories: NewMemory[],
    embeddings: (number[] | null)[],
  ): Promise<number[]> {
    if (memories.length !== embeddings.length) {
      throw new Error(`${memories.length} memories but ${embeddings.length} embeddings`);
    }
    const literals = embeddings.map((e) =>
      e === null ? null : toVectorLiteral(e, EMBEDDING_DIMS),
    );
    return inTransaction(this.pool, async (client) => {
      const ids: number[] = [];
      for (const [i, memory] of memories.entries()) {
        ids.push(await this.insertMemory(client, lifeId, memory, literals[i] ?? null));
      }
      return ids;
    });
  }

  async deactivateBeliefs(lifeId: string, beliefs: string[]): Promise<number> {
    return this.retireBeliefs(this.pool, lifeId, beliefs);
  }

  /** Marks a commitment (a memory with a provenance of `commitment`) as resolved; returns whether a row changed. */
  async resolveCommitment(lifeId: string, memoryId: number): Promise<boolean> {
    return this.resolveIn(this.pool, lifeId, memoryId);
  }

  /** Applies one reflection's writes in one transaction; see `MemoryStore.commitReflection`. */
  async commitReflection(lifeId: string, writes: ReflectionWrites): Promise<number> {
    if (writes.memories.length !== writes.embeddings.length) {
      throw new Error(
        `${writes.memories.length} memories but ${writes.embeddings.length} embeddings`,
      );
    }
    const literals = writes.embeddings.map((e) =>
      e === null ? null : toVectorLiteral(e, EMBEDDING_DIMS),
    );
    return inTransaction(this.pool, async (client) => {
      for (const [i, memory] of writes.memories.entries()) {
        await this.insertMemory(client, lifeId, memory, literals[i] ?? null);
      }
      for (const memoryId of writes.resolve) await this.resolveIn(client, lifeId, memoryId);
      const retired = await this.retireBeliefs(client, lifeId, writes.deactivate);
      await this.writeRelationships(client, lifeId, writes.relationships, writes.day);
      if (writes.goals !== null) await this.writeGoals(client, lifeId, writes.goals);
      await this.setSleepDay(client, lifeId, writes.day);
      return retired;
    });
  }

  /**
   * One `relationships` row per update when the name resolves to an `agents` row (by `name` or
   * `game_account`, the latest life first); the table's foreign key allows no other party. Any
   * other name is kept as a semantic memory with the subject `relationship:<name>`.
   */
  async upsertRelationships(
    lifeId: string,
    updates: { name: string; impression: string; trust: number }[],
    day: number,
  ): Promise<void> {
    await inTransaction(this.pool, (client) =>
      this.writeRelationships(client, lifeId, updates, day),
    );
  }

  async replaceGoals(lifeId: string, goals: { goal: string; why: string }[]): Promise<void> {
    await inTransaction(this.pool, (client) => this.writeGoals(client, lifeId, goals));
  }

  async setLastSleepDay(lifeId: string, day: number): Promise<void> {
    await this.setSleepDay(this.pool, lifeId, day);
  }

  /**
   * Embeds up to `limit` active memories that have no vector yet (oldest first) and stores the
   * vectors. Returns how many were filled; throws when the embedder fails, leaving the rest.
   */
  async backfillEmbeddings(limit: number): Promise<number> {
    if (this.embedder === undefined) throw new Error('backfillEmbeddings needs an embedder');
    const pending = await this.pool.query(
      `SELECT memory_id, text FROM memories
       WHERE embedding IS NULL AND COALESCE(active, true) ORDER BY memory_id LIMIT $1`,
      [limit],
    );
    if (pending.rows.length === 0) return 0;
    const vectors = await this.embedder.embed(
      pending.rows.map((r) => r.text as string),
      'document',
    );
    for (const [i, row] of pending.rows.entries()) {
      await this.pool.query('UPDATE memories SET embedding = $2::vector WHERE memory_id = $1', [
        row.memory_id,
        toVectorLiteral(vectors[i] ?? [], EMBEDDING_DIMS),
      ]);
    }
    return pending.rows.length;
  }

  private async retireBeliefs(
    client: SqlClient,
    lifeId: string,
    beliefs: string[],
  ): Promise<number> {
    if (beliefs.length === 0) return 0;
    const result = await client.query(
      `UPDATE memories SET active = false
       WHERE agent_id = $1 AND kind = 'semantic' AND COALESCE(active, true) AND text = ANY($2::text[])`,
      [lifeId, beliefs],
    );
    return result.rowCount ?? 0;
  }

  private async resolveIn(client: SqlClient, lifeId: string, memoryId: number): Promise<boolean> {
    const result = await client.query(
      `UPDATE memories SET resolved = true
       WHERE agent_id = $1 AND memory_id = $2 AND provenance = 'commitment'
         AND NOT COALESCE(resolved, false)`,
      [lifeId, memoryId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async writeRelationships(
    client: SqlClient,
    lifeId: string,
    updates: { name: string; impression: string; trust: number }[],
    day: number,
  ): Promise<void> {
    for (const update of updates) {
      const found = await client.query(
        `SELECT agent_id FROM agents WHERE (name = $1 OR game_account = $1) AND agent_id <> $2
         ORDER BY life_seq DESC LIMIT 1`,
        [update.name, lifeId],
      );
      const otherId: string | undefined = found.rows[0]?.agent_id;
      if (otherId !== undefined) {
        await client.query(
          `INSERT INTO relationships (agent_id, other_id, impression, trust, last_seen_day)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id, other_id)
           DO UPDATE SET impression = EXCLUDED.impression, trust = EXCLUDED.trust,
                         last_seen_day = EXCLUDED.last_seen_day`,
          [lifeId, otherId, update.impression, update.trust, day],
        );
        continue;
      }
      // The earlier memory of this name is retired, so one name keeps one active memory.
      const subject = `relationship:${update.name}`;
      await client.query(
        `UPDATE memories SET active = false
         WHERE agent_id = $1 AND subject = $2 AND COALESCE(active, true)`,
        [lifeId, subject],
      );
      const text = `${update.name}: ${update.impression} (trust ${update.trust})`;
      const [embedding] = await this.tryEmbed([text]);
      const memory: NewMemory = {
        kind: 'semantic',
        provenance: 'interpretation',
        subject,
        text,
        createdDay: day,
        sourceThought: null,
        sourceAgent: null,
        dueTick: null,
      };
      await this.insertMemory(
        client,
        lifeId,
        memory,
        embedding === undefined ? null : toVectorLiteral(embedding, EMBEDDING_DIMS),
      );
    }
  }

  private async writeGoals(
    client: SqlClient,
    lifeId: string,
    goals: { goal: string; why: string }[],
  ): Promise<void> {
    await client.query('DELETE FROM goals WHERE agent_id = $1', [lifeId]);
    for (const [rank, g] of goals.entries()) {
      await client.query('INSERT INTO goals (agent_id, rank, goal, why) VALUES ($1, $2, $3, $4)', [
        lifeId,
        rank,
        g.goal,
        g.why,
      ]);
    }
  }

  private async setSleepDay(client: SqlClient, lifeId: string, day: number): Promise<void> {
    const result = await client.query('UPDATE agents SET last_sleep_day = $2 WHERE agent_id = $1', [
      lifeId,
      day,
    ]);
    if ((result.rowCount ?? 0) === 0) throw new Error(`no agent ${lifeId}`);
  }

  private async search(
    lifeId: string,
    kind: MemoryRow['kind'],
    embedding: number[],
    topK: number,
  ): Promise<MemoryRow[]> {
    const result = await this.pool.query(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE agent_id = $1 AND kind = $2 AND COALESCE(active, true) AND embedding IS NOT NULL
       ORDER BY embedding <=> $3::vector, memory_id LIMIT $4`,
      [lifeId, kind, toVectorLiteral(embedding, EMBEDDING_DIMS), topK],
    );
    return result.rows.map(memoryRow);
  }

  private async insertMemory(
    client: SqlClient,
    lifeId: string,
    memory: NewMemory,
    vectorLiteral: string | null,
  ): Promise<number> {
    const result = await client.query(
      `INSERT INTO memories (agent_id, kind, provenance, subject, text, embedding, created_day,
         source_thought, source_agent, due_tick, resolved, active)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, false, true)
       RETURNING memory_id`,
      [
        lifeId,
        memory.kind,
        memory.provenance,
        memory.subject,
        memory.text,
        vectorLiteral,
        memory.createdDay,
        memory.sourceThought,
        memory.sourceAgent,
        memory.dueTick,
      ],
    );
    return Number(result.rows[0]?.memory_id);
  }

  private async tryEmbed(texts: string[]): Promise<number[][]> {
    if (this.embedder === undefined) return [];
    try {
      return await this.embedder.embed(texts, 'document');
    } catch {
      return [];
    }
  }
}
