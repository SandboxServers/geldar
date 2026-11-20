import type { WorldEvent } from '@geldar/contract';
import type { Domain } from '@geldar/psyche';
import { combatFactAwards, killKey } from './combat.ts';
import { CROP_BLOCKS, CROP_ITEMS, isMiningItem } from './matrix.ts';

/**
 * Whether building XP can be awarded. The Body's intent event carries `program` on every change
 * (golem/src/body/executor.ts setState, AN-09c), so a completed build intent reads it here. An
 * event with no `program` (from before AN-09c) awards nothing.
 */
export const BUILDING_XP_SOURCE_AVAILABLE = true;

/** The longest evidence key the ledger takes (sql/0050, the xp_evidence key CHECK). */
export const EVIDENCE_KEY_MAX = 200;

/** The chunk index bound the event schema allows (chunk-visited-event.schema.json). */
const CHUNK_LIMIT = 2_000_000;

/** The dimension pattern the event schema allows (chunk-visited-event.schema.json). */
const DIMENSION = /^[a-z0-9_:.-]{1,64}$/;

export interface XpAward {
  lifeId: string;
  domain: Domain;
  evidenceKey: string;
  sourceEventId: string;
  worldTick: number;
}

type Fields = Record<string, unknown>;
export type Award = (domain: Domain, evidenceKey: string) => XpAward[];

function fieldsOf(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

/** The names in a `collected` map (item name to count); anything else collected nothing. */
function collectedItems(detail: Fields): string[] {
  const collected = fieldsOf(detail.collected);
  return collected ? Object.keys(collected) : [];
}

/**
 * The XP awards one WorldEvent gives, from the Body's own typed records. Pure, never throws, and
 * `[]` for anything that is not an accomplishment (a running or failed record, another event
 * type, an unknown `kind`, a malformed payload, or an event whose `agent_id` is not the life).
 * `action_outcome` and `receipt` are not sources: each is a view of an action already counted.
 * A `combat_fact` (the plugin's view of a fight, AN-47b) pays the same encounter key as the Body's
 * completed kill, so one encounter pays once.
 */
export function awardsFor(event: WorldEvent): XpAward[] {
  try {
    return awardsOf(event);
  } catch {
    return [];
  }
}

function awardsOf(event: WorldEvent): XpAward[] {
  const payload = fieldsOf(event.payload);
  if (!payload || typeof payload.life_id !== 'string') return [];
  const lifeId = payload.life_id;
  if (event.agent_id !== lifeId) return [];
  const award: Award = (domain, evidenceKey) =>
    evidenceKey.length > EVIDENCE_KEY_MAX
      ? []
      : [
          {
            lifeId,
            domain,
            evidenceKey,
            sourceEventId: event.source_event_id,
            worldTick: event.world_tick,
          },
        ];
  switch (event.type) {
    case 'action':
      return actionAwards(payload, award);
    case 'intent':
      return intentAwards(payload, award);
    case 'chunk_visited':
      return chunkAwards(payload, award);
    case 'combat_fact':
      return combatFactAwards(payload, award);
    default:
      return [];
  }
}

/** One award per action, keyed by its `action_id`; only the completed record counts. */
function actionAwards(payload: Fields, award: Award): XpAward[] {
  if (payload.state !== 'completed' || typeof payload.action_id !== 'string') return [];
  const id = payload.action_id;
  const detail = fieldsOf(fieldsOf(payload.result)?.detail) ?? {};
  switch (payload.kind) {
    case 'attack': {
      // The kill pays the encounter key (AN-47b): a completed kill with no valid target_uuid pays nothing here.
      const key =
        detail.killed === true && detail.target_kind === 'mob'
          ? killKey(payload.life_id as string, detail)
          : null;
      return key ? award('combat', key) : [];
    }
    case 'mine': {
      // A crop mined is farming, not mining: the harvest row takes it first.
      const items = collectedItems(detail);
      if (items.some((item) => CROP_ITEMS.has(item))) return award('farming', `harvest:${id}`);
      const mined = typeof detail.mined === 'number' && detail.mined >= 1;
      return mined && items.some((item) => isMiningItem(item)) ? award('mining', `mine:${id}`) : [];
    }
    case 'place':
      return typeof detail.block === 'string' && CROP_BLOCKS.has(detail.block)
        ? award('farming', `sow:${id}`)
        : [];
    case 'craft':
      return typeof detail.crafted === 'number' && detail.crafted >= 1
        ? award('crafting', `craft:${id}`)
        : [];
    case 'give':
      // `to` is an in-game username; the event does not carry the agent's own name, so a give to
      // the life itself is not detectable here (AN-09a worknote). Only an empty `to` is refused.
      return typeof detail.to === 'string' && detail.to.length > 0
        ? award('social', `give:${id}`)
        : [];
    default:
      return [];
  }
}

/**
 * One award per completed structure, keyed by its `intent_id`, when the completed intent's
 * `program` is `build`. Gated by BUILDING_XP_SOURCE_AVAILABLE, which is true; set it false to
 * switch the row off.
 */
function intentAwards(payload: Fields, award: Award): XpAward[] {
  if (!BUILDING_XP_SOURCE_AVAILABLE) return [];
  if (payload.state !== 'completed' || payload.program !== 'build') return [];
  if (typeof payload.intent_id !== 'string') return [];
  return award('building', `build:${payload.intent_id}`);
}

function isChunkIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= CHUNK_LIMIT;
}

/** One award per chunk: a revisit is the same key, so the ledger's unique key takes it once. */
function chunkAwards(payload: Fields, award: Award): XpAward[] {
  const { dimension, cx, cz } = payload;
  if (typeof dimension !== 'string' || !DIMENSION.test(dimension)) return [];
  if (!isChunkIndex(cx) || !isChunkIndex(cz)) return [];
  return award('exploring', `chunk:${dimension}:${cx}:${cz}`);
}
