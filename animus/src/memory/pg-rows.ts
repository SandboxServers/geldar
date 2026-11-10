import type { AgentRow, MemoryRow } from '../ports/index.ts';

/** The columns of a `memories` row, with the nullable flags defaulted as the mapping expects. */
export const MEMORY_COLUMNS =
  'memory_id, agent_id, kind, provenance, subject, text, created_day, source_thought, ' +
  'source_agent, due_tick, COALESCE(resolved, false) AS resolved, COALESCE(active, true) AS active';

// biome-ignore lint/suspicious/noExplicitAny: a pg row.
export function memoryRow(r: any): MemoryRow {
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

export const optionalNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// biome-ignore lint/suspicious/noExplicitAny: a pg row.
export function agentRow(r: any): AgentRow {
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
