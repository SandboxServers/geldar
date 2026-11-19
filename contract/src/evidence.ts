/**
 * Evidence sources for observed fights, container takes and conversation exchanges (AN-46, decision
 * 0345). The combat key is the encounter key of decision 0321: every combat source (the Body's kill,
 * the plugin's combat fact) names the same key for one encounter, so one fight pays once.
 */

import type { CombatFactPayload } from './generated/types.ts';
import { validateCombatFactPayload as validateCombatFactPayloadSchema } from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export type { CombatFactPayload } from './generated/types.ts';

/** Same pattern as `LifeId` in common.schema.json. */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
/** A UUID as Minecraft prints it, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The combat evidence key of one encounter: `enc:<life_id>:<mob entity UUID in lowercase>`. Null when
 * the life id is not a LifeId or the mob id is not a UUID. The UUID may come in either case.
 */
export function encounterKey(lifeId: string, mobUuid: string): string | null {
  if (!LIFE_ID.test(lifeId) || !UUID.test(mobUuid)) return null;
  return `enc:${lifeId}:${mobUuid.toLowerCase()}`;
}

/** Checks a value against combat-fact-event.schema.json (the payload of a `combat_fact` event). Never throws. */
export function validateCombatFactPayload(value: unknown): ValidationResult<CombatFactPayload> {
  if (validateCombatFactPayloadSchema(value)) {
    return { ok: true, value: value as CombatFactPayload };
  }
  return {
    ok: false,
    errors: (validateCombatFactPayloadSchema.errors ?? []).map(formatError),
  };
}
