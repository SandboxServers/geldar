import {
  type CharacterSheet,
  type DecisionEventPayload,
  type RollEventPayload,
  type SheetAdoptedPayload,
  validateDecisionEventPayload,
  validateRollEventPayload,
  validateSheetAdoptedPayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import { type DrawKey, decisionId, ENGINE_VERSION, type Roll } from '@geldar/psyche';
import { eventIdFor } from '../body/derived-id.ts';

/** Minecraft ticks in one world day. */
const TICKS_PER_DAY = 24_000;

/** What every audit envelope shares: where it came from, the life, the world tick and the wall clock. */
export interface AuditEnvelope {
  shard: string;
  lifeId: string;
  tick: number;
  at: string;
}

/** The decision fields a caller supplies; the publisher fills the life, the id, the engine and the producer. */
export type DecisionFields = Omit<
  DecisionEventPayload,
  'life_id' | 'decision_id' | 'engine_version' | 'producer'
>;

/** A built event, or the reasons it is not valid (payload or envelope). */
export type BuiltEvent = { ok: true; event: WorldEvent } | { ok: false; errors: string[] };

/** The stable id of a roll: one draw is one event, so a retry or a replay is deduplicated. */
export function rollEventId(key: DrawKey, drawIndex: number): string {
  return eventIdFor(`roll:${decisionId(key)}:${drawIndex}`);
}

/** The stable id of a decision, from its decision id. */
export function decisionEventId(id: string): string {
  return eventIdFor(`decision:${id}`);
}

/** The stable id of a sheet adoption: one life adopting one sheet is one event. */
export function sheetAdoptedEventId(lifeId: string, sheetHash: string): string {
  return eventIdFor(`sheet_adopted:${lifeId}:${sheetHash}`);
}

/** Checks the payload first, then wraps it in a WorldEvent envelope and checks that too. */
function build(
  ctx: AuditEnvelope,
  type: string,
  sourceEventId: string,
  payload: object,
  check: { ok: boolean; errors?: string[] },
): BuiltEvent {
  if (!check.ok) return { ok: false, errors: check.errors ?? ['payload is not valid'] };
  const event: WorldEvent = {
    source_event_id: sourceEventId,
    at: ctx.at,
    shard: ctx.shard,
    world_day: Math.floor(ctx.tick / TICKS_PER_DAY),
    world_tick: ctx.tick,
    type,
    agent_id: ctx.lifeId,
    payload: payload as WorldEvent['payload'],
  };
  const whole = validateWorldEvent(event);
  if (!whole.ok) return { ok: false, errors: whole.errors };
  return { ok: true, event };
}

/** A `roll` event for one draw. The world tick is the draw's own tick, not the publish time. */
export function rollRecord(
  ctx: AuditEnvelope,
  key: DrawKey,
  roll: Roll,
  drawIndex: number,
  inputs?: RollEventPayload['inputs'],
): BuiltEvent {
  if (!Number.isSafeInteger(drawIndex)) {
    return { ok: false, errors: [`draw index must be a safe integer: ${drawIndex}`] };
  }
  if (roll.fx !== key.fx) {
    return { ok: false, errors: [`roll fx ${roll.fx} does not match the key fx ${key.fx}`] };
  }
  const id = decisionId(key);
  const payload: RollEventPayload = {
    life_id: ctx.lifeId,
    decision_id: id,
    draw_index: drawIndex,
    engine_version: ENGINE_VERSION,
    producer: key.producer,
    fx: key.fx,
    score: roll.score,
    proficiency: roll.proficiency,
    dc: roll.dc,
    mode: roll.mode,
    dice: roll.dice as RollEventPayload['dice'],
    kept: roll.kept,
    bonus: roll.bonus,
    total: roll.total,
    success: roll.success,
    ...(inputs ? { inputs } : {}),
  };
  return build(
    { ...ctx, tick: key.tick },
    'roll',
    rollEventId(key, drawIndex),
    payload,
    validateRollEventPayload(payload),
  );
}

/** A `decision` event for one draw. The decision id is the key's id; the fx must match the key. */
export function decisionRecord(
  ctx: AuditEnvelope,
  key: DrawKey,
  fields: DecisionFields,
): BuiltEvent {
  if (fields.fx !== key.fx) {
    return { ok: false, errors: [`decision fx ${fields.fx} does not match the key fx ${key.fx}`] };
  }
  const id = decisionId(key);
  const payload: DecisionEventPayload = {
    ...fields,
    life_id: ctx.lifeId,
    decision_id: id,
    engine_version: ENGINE_VERSION,
    producer: key.producer,
  };
  return build(
    { ...ctx, tick: key.tick },
    'decision',
    decisionEventId(id),
    payload,
    validateDecisionEventPayload(payload),
  );
}

/**
 * The gap evidence: a `decision` of kind `audit_gap` that says how many records were dropped and
 * since which tick. `n` makes the decision id unique per gap event within one generation and tick.
 */
export function gapRecord(
  ctx: AuditEnvelope,
  generation: number,
  n: number,
  dropped: number,
  sinceTick: number,
): BuiltEvent {
  const id = `body:${ctx.lifeId}:${generation}:${ctx.tick}:audit_gap:${n}`;
  const payload: DecisionEventPayload = {
    life_id: ctx.lifeId,
    decision_id: id,
    engine_version: ENGINE_VERSION,
    producer: 'body',
    fx: 'audit_gap',
    kind: 'audit_gap',
    dropped,
    since_tick: sinceTick,
  };
  return build(
    ctx,
    'decision',
    decisionEventId(id),
    payload,
    validateDecisionEventPayload(payload),
  );
}

/** A `sheet_adopted` event: the life, the sheet, its hash and where it came from. */
export function adoptionRecord(
  ctx: AuditEnvelope,
  sheet: CharacterSheet,
  sheetHash: string,
  source: SheetAdoptedPayload['source'],
): BuiltEvent {
  const payload: SheetAdoptedPayload = {
    life_id: ctx.lifeId,
    sheet,
    sheet_hash: sheetHash,
    source,
  };
  return build(
    ctx,
    'sheet_adopted',
    sheetAdoptedEventId(ctx.lifeId, sheetHash),
    payload,
    validateSheetAdoptedPayload(payload),
  );
}
