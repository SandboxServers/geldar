/**
 * The config of a managed player host (BODY-HOST design, sections 2 and 3, decisions 0260 and 0261).
 * A managed Body is started by the body helper for one agent. Its world and mind settings come from
 * the read-only shard file, as a sovereign player's do; its own identity (display name, harness,
 * model, character sheet) comes from ONE database row, the JSON that `player_host_config(life_id)`
 * returns. No RCON is involved: the whitelist is the helper's admit one-shot, not the Body's.
 */
import type { CharacterLog } from '../character/character-config.ts';
import { buildPlayerConfig, type PlayerConfig, record } from './player-config.ts';

/** The exit code of a managed host whose roster row is gone (the helper sweep removes the container). */
export const NO_HOST_CONFIG_EXIT = 78;

/** A managed life id: `ag_` and 1 to 12 lower-case letters or digits (the SQL `managed_life_id`). */
const MANAGED_LIFE_ID = /^ag_[a-z0-9]{1,12}$/;

/** The four keys of the `player_host_config` JSON, and no others. */
const HOST_CONFIG_KEYS = ['character_sheet', 'display_name', 'harness', 'model'];

/** The JSON of `player_host_config(life_id)`, as the database returns it. */
export interface HostConfigRow {
  display_name: unknown;
  harness: unknown;
  model: unknown;
  character_sheet: unknown;
}

/** The life id, when it is a managed life id; throws otherwise (no other text reaches Docker or NATS). */
export function managedLifeId(value: unknown): string {
  if (typeof value !== 'string' || !MANAGED_LIFE_ID.test(value)) {
    throw new Error('the managed life id must be ag_ and 1 to 12 lower-case letters or digits');
  }
  return value;
}

/** The row, checked to hold exactly the four keys of the function and no other. */
function hostConfigRow(value: unknown): HostConfigRow {
  const row = record(value, 'player_host_config row');
  const keys = Object.keys(row).sort();
  if (
    keys.length !== HOST_CONFIG_KEYS.length ||
    keys.some((key, i) => key !== HOST_CONFIG_KEYS[i])
  ) {
    throw new Error(
      'player_host_config row must hold exactly display_name, harness, model, character_sheet',
    );
  }
  return row as unknown as HostConfigRow;
}

/**
 * Builds the config of a managed Body from the shard file and the host row. Throws on a malformed
 * life id, on a row that is not the four keys, and on Adam's life id (`mind.lives`), as
 * parsePlayerConfig does. The start mode is always `always`: the container exists because `start`
 * was asked for.
 */
export function parseManagedPlayerConfig(
  doc: unknown,
  lifeIdInput: unknown,
  dbRow: unknown,
  log?: CharacterLog,
): PlayerConfig {
  const lifeId = managedLifeId(lifeIdInput);
  const row = hostConfigRow(dbRow);
  return buildPlayerConfig({
    root: record(doc, 'shard file'),
    playerId: lifeId,
    lifeId,
    fields: {
      name: row.display_name,
      harness: row.harness ?? undefined,
      model: row.model ?? undefined,
      character_sheet: row.character_sheet ?? undefined,
    },
    start: 'always',
    ...(log === undefined ? {} : { log }),
  });
}
