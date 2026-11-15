/**
 * Projects `roll`, `decision` and `sheet_adopted` events into `rolls`, `decisions` and the adoption
 * log `character_sheet_adoptions`, and an adoption into `agents.character_sheet` (migration 0051,
 * decisions 0171, 0186, D-CS-07). The writer inserts the `events` row first, in the same transaction,
 * so every audit row has its event.
 *
 * Rules: a payload is validated, and its `life_id` must be the event's `agent_id` (else a class-23
 * refusal, which the consumer dead-letters). Roll and decision inserts and the adoption log insert are
 * `ON CONFLICT DO NOTHING`, so redelivery and a producer retry converge. A `d20` decision is stored even
 * when its roll rows have not arrived (no foreign key on `roll_event_ids`). An adoption sets the
 * baseline only while the agent has none; otherwise the stored hash decides `same` or `conflict`, and
 * the baseline is never replaced. Other event types are ignored here.
 */
import {
  type CharacterSheet,
  type DecisionEventPayload,
  type RollEventPayload,
  type SheetAdoptedPayload,
  validateDecisionEventPayload,
  validateRollEventPayload,
  validateSheetAdoptedPayload,
  type WorldEvent,
} from '@geldar/contract';
import { ProjectionRejectedError } from '../projection.ts';

/** The event types this module writes tables for. The writer runs `projectAudit` for these. */
export const AUDIT_TYPES: ReadonlySet<string> = new Set(['roll', 'decision', 'sheet_adopted']);

/** A row of `rolls`. `proficiency` is 0 when the payload has none; `inputs` is null when absent. */
export interface RollRow {
  source_event_id: string;
  life_id: string;
  world_tick: number;
  decision_id: string;
  draw_index: number;
  engine_version: number;
  producer: string;
  fx: string;
  score: number;
  proficiency: number;
  dc: number;
  mode: string;
  dice: number[];
  kept: number;
  bonus: number;
  total: number;
  success: boolean;
  inputs: unknown;
}

/** A row of `decisions`. Optional payload fields become null. */
export interface DecisionRow {
  source_event_id: string;
  life_id: string;
  world_tick: number;
  decision_id: string;
  engine_version: number;
  producer: string;
  fx: string;
  kind: string;
  policy: string | null;
  inputs: unknown;
  result: unknown;
  roll_event_ids: string[] | null;
  thought_id: string | null;
  action_id: string | null;
  intent_id: string | null;
  dropped: number | null;
  since_tick: number | null;
}

/** What the audit projection reads and writes; Postgres in production, a map in the unit tests. */
export interface AuditStore {
  insertRoll(row: RollRow): Promise<void>;
  insertDecision(row: DecisionRow): Promise<void>;
  /**
   * Sets the baseline sheet of the life when it has none, writes one adoption row for the event, and
   * says what happened: `adopted` (baseline set), `same` (equal hash) or `conflict` (another hash).
   */
  adopt(
    life: string,
    sheet: CharacterSheet,
    hash: string,
    source: string,
    sourceEventId: string,
  ): Promise<'adopted' | 'same' | 'conflict'>;
}

function rejectInvalid(type: string, errors: readonly string[]): never {
  throw new ProjectionRejectedError(
    '23514',
    `${type} event payload is not valid: ${errors.join('; ')}`,
  );
}

/** A payload may only write rows for the life its event is about. */
function requireOwnLife(event: WorldEvent, life: string): void {
  if (life !== event.agent_id) {
    throw new ProjectionRejectedError(
      '23514',
      `${event.type} event for life ${life} is not for its agent ${event.agent_id ?? '(none)'}`,
    );
  }
}

async function projectRoll(event: WorldEvent, store: AuditStore): Promise<void> {
  const parsed = validateRollEventPayload(event.payload);
  if (!parsed.ok) rejectInvalid('roll', parsed.errors);
  const p: RollEventPayload = parsed.value;
  requireOwnLife(event, p.life_id);
  await store.insertRoll({
    source_event_id: event.source_event_id,
    life_id: p.life_id,
    world_tick: event.world_tick,
    decision_id: p.decision_id,
    draw_index: p.draw_index,
    engine_version: p.engine_version,
    producer: p.producer,
    fx: p.fx,
    score: p.score,
    proficiency: p.proficiency ?? 0,
    dc: p.dc,
    mode: p.mode,
    dice: [...p.dice],
    kept: p.kept,
    bonus: p.bonus,
    total: p.total,
    success: p.success,
    inputs: p.inputs ?? null,
  });
}

async function projectDecision(event: WorldEvent, store: AuditStore): Promise<void> {
  const parsed = validateDecisionEventPayload(event.payload);
  if (!parsed.ok) rejectInvalid('decision', parsed.errors);
  const p: DecisionEventPayload = parsed.value;
  requireOwnLife(event, p.life_id);
  await store.insertDecision({
    source_event_id: event.source_event_id,
    life_id: p.life_id,
    world_tick: event.world_tick,
    decision_id: p.decision_id,
    engine_version: p.engine_version,
    producer: p.producer,
    fx: p.fx,
    kind: p.kind,
    policy: p.policy ?? null,
    inputs: p.inputs ?? null,
    result: p.result ?? null,
    roll_event_ids: p.roll_event_ids === undefined ? null : [...p.roll_event_ids],
    thought_id: p.thought_id ?? null,
    action_id: p.action_id ?? null,
    intent_id: p.intent_id ?? null,
    dropped: p.dropped ?? null,
    since_tick: p.since_tick ?? null,
  });
}

async function projectAdoption(event: WorldEvent, store: AuditStore): Promise<void> {
  const parsed = validateSheetAdoptedPayload(event.payload);
  if (!parsed.ok) rejectInvalid('sheet_adopted', parsed.errors);
  const p: SheetAdoptedPayload = parsed.value;
  requireOwnLife(event, p.life_id);
  await store.adopt(p.life_id, p.sheet, p.sheet_hash, p.source, event.source_event_id);
}

/** Projects one audit event; a no-op for other types. Rejects with `ProjectionRejectedError`. */
export async function projectAudit(event: WorldEvent, store: AuditStore): Promise<void> {
  if (event.type === 'roll') await projectRoll(event, store);
  else if (event.type === 'decision') await projectDecision(event, store);
  else if (event.type === 'sheet_adopted') await projectAdoption(event, store);
}
