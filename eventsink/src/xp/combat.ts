// The combat evidence key (AN-47b, decision 0321). The Body's completed kill and the plugin's combat_fact
// name the same key for one encounter, so one fight pays once: the ledger's unique key takes the second.
import { encounterKey } from '@geldar/contract';
import type { Award, XpAward } from './awards.ts';

type Fields = Record<string, unknown>;

/** The combat_fact kinds that pay (combat-fact-event.schema.json). */
const COMBAT_KINDS: ReadonlySet<string> = new Set(['hostile_kill', 'fight_survived']);

/**
 * The one combat key of a completed kill record: the encounter key of the target's entity UUID, or
 * null when the record carries no valid `target_uuid` (a record from before AN-47b, or a mob with no UUID).
 */
export function killKey(lifeId: string, detail: Fields): string | null {
  return typeof detail.target_uuid === 'string' ? encounterKey(lifeId, detail.target_uuid) : null;
}

/**
 * One award per encounter from a combat_fact payload. `[]` unless `kind` is a combat kind, `mob` is a
 * string and `encounter_key` is the encounter key of this payload's own life: the key must start with
 * `enc:<life_id>:` and its UUID part must make a valid encounter key. Other fields (such as `player`) are
 * ignored.
 */
export function combatFactAwards(payload: Fields, award: Award): XpAward[] {
  const lifeId = payload.life_id;
  const key = payload.encounter_key;
  if (typeof lifeId !== 'string' || typeof key !== 'string') return [];
  if (typeof payload.kind !== 'string' || !COMBAT_KINDS.has(payload.kind)) return [];
  if (typeof payload.mob !== 'string') return [];
  const prefix = `enc:${lifeId}:`;
  if (!key.startsWith(prefix)) return [];
  return encounterKey(lifeId, key.slice(prefix.length)) === key ? award('combat', key) : [];
}
