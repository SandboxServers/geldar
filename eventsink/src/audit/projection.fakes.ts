/** An in-memory `AuditStore` and event builders for the audit projection tests. */
import type { CharacterSheet, WorldEvent } from '@geldar/contract';
import { eventOf } from '../projection.fakes.ts';
import { ProjectionRejectedError } from '../projection.ts';
import type { AuditStore, DecisionRow, RollRow } from './projection.ts';

export const LIFE_ID = 'ag_kestrel_01';
export const ROLL_ID = 'ev_01HZX3V9Q4M2K8R7T6Y5W4E3D8';
export const SHEET_HASH = 'a'.repeat(64);
export const OTHER_HASH = 'b'.repeat(64);

export const SHEET: CharacterSheet = {
  version: 1,
  attributes: { curiosity: 3, common_sense: 4, cleverness: 2, aggression: 5 },
  alignment: { law: 3, good: 4 },
  op_modes: { explorer: 3, farmer: 2, miner: 4, builder: 1, crafter: 3, warrior: 5, nitwit: 2 },
};

/** A plain d20 check: one die, no advantage. */
export const ROLL = {
  life_id: LIFE_ID,
  decision_id: 'dec_gather_wood_0042',
  draw_index: 0,
  engine_version: 1,
  producer: 'body',
  fx: 'gather',
  score: 3,
  dc: 12,
  mode: 'flat',
  dice: [14],
  kept: 14,
  bonus: 1,
  total: 15,
  success: true,
};

export const DECISION = {
  life_id: LIFE_ID,
  decision_id: 'dec_pick_route_0007',
  engine_version: 1,
  producer: 'body',
  fx: 'route',
  kind: 'deterministic',
};

/** A `roll` event: `n` fixes the source id, `payload` overrides fields of ROLL. */
export function rollEvent(n = 1, payload: Record<string, unknown> = {}): WorldEvent {
  return eventOf('roll', { ...ROLL, ...payload }, n);
}

/** A `decision` event for LIFE_ID; `payload` overrides fields of DECISION. */
export function decisionEvent(n = 1, payload: Record<string, unknown> = {}): WorldEvent {
  return eventOf('decision', { ...DECISION, ...payload }, n);
}

/** A `sheet_adopted` event for `life` (default LIFE_ID); the event's agent is that life. */
export function sheetEvent(
  n = 1,
  payload: Record<string, unknown> = {},
  life: string = LIFE_ID,
): WorldEvent {
  const event = eventOf(
    'sheet_adopted',
    { life_id: life, sheet: SHEET, sheet_hash: SHEET_HASH, source: 'config', ...payload },
    n,
  );
  return { ...event, agent_id: life };
}

interface AgentRow {
  sheet: CharacterSheet | null;
  sheet_hash: string | null;
}

/** Keeps the UNIQUE keys and the ON CONFLICT DO NOTHING of the real tables, not their triggers. */
export class MemoryAuditStore implements AuditStore {
  readonly rolls = new Map<string, RollRow>();
  readonly decisions = new Map<string, DecisionRow>();
  readonly adoptions = new Map<
    string,
    { life_id: string; sheet_hash: string; source: string; result: string }
  >();
  readonly agents = new Map<string, AgentRow>([[LIFE_ID, { sheet: null, sheet_hash: null }]]);

  async insertRoll(row: RollRow): Promise<void> {
    const clash = [...this.rolls.values()].some(
      (r) =>
        r.life_id === row.life_id &&
        r.decision_id === row.decision_id &&
        r.draw_index === row.draw_index,
    );
    if (!this.rolls.has(row.source_event_id) && !clash) {
      this.rolls.set(row.source_event_id, structuredClone(row));
    }
  }

  async insertDecision(row: DecisionRow): Promise<void> {
    const clash = [...this.decisions.values()].some(
      (d) => d.life_id === row.life_id && d.decision_id === row.decision_id,
    );
    if (!this.decisions.has(row.source_event_id) && !clash) {
      this.decisions.set(row.source_event_id, structuredClone(row));
    }
  }

  async adopt(
    life: string,
    sheet: CharacterSheet,
    hash: string,
    source: string,
    sourceEventId: string,
  ): Promise<'adopted' | 'same' | 'conflict'> {
    const agent = this.agents.get(life);
    if (agent === undefined) {
      throw new ProjectionRejectedError('23503', `sheet_adopted for unknown life ${life}`);
    }
    let result: 'adopted' | 'same' | 'conflict';
    if (agent.sheet_hash === null) {
      agent.sheet = structuredClone(sheet);
      agent.sheet_hash = hash;
      result = 'adopted';
    } else {
      result = agent.sheet_hash === hash ? 'same' : 'conflict';
    }
    if (!this.adoptions.has(sourceEventId)) {
      this.adoptions.set(sourceEventId, { life_id: life, sheet_hash: hash, source, result });
    }
    return result;
  }
}
