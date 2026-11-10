/**
 * One sovereign player's Body config (spec 5.15.2, decisions 0040, 0052). It is read from
 * `sovereign.players[]` in `shards/<shard>.yaml` and returned in the `AdamConfig` shape, so the
 * same Body code runs for a ranger as for Adam. A player's Minecraft username is its life id: the
 * player id with hyphens turned into underscores (`ag-jason-01` is `ag_jason_01`).
 */
import { type AdamConfig, parseAdamConfig } from '../adam/adam-config.ts';

/** The LifeId pattern of contract/schemas/common.schema.json (as registry.ts keeps it). */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
/** A launcher player id: hyphens, lowercase, the same shape as the life id. */
const PLAYER_ID = /^ag-[a-z][a-z0-9-]{0,15}-[0-9]{2,}$/;

/** One player's config: the `AdamConfig` shape, plus the player id and the presence start mode. */
export interface PlayerConfig extends AdamConfig {
  playerId: string;
  /** `sovereign.presence.start`: `on_demand` waits for a presence up; `always` starts at boot. */
  start: 'on_demand' | 'always';
}

/** The life id of a player id, or null when the player id is malformed. */
export function lifeIdForPlayer(playerId: string): string | null {
  if (!PLAYER_ID.test(playerId)) return null;
  const lifeId = playerId.replaceAll('-', '_');
  return LIFE_ID.test(lifeId) ? lifeId : null;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is missing or is not a map`);
  }
  return value as Record<string, unknown>;
}

/**
 * Builds the config of `playerId` from a parsed shard file. Throws when the player is not listed,
 * when its id or life id fails the patterns, when its life id is not the id's underscore form, or
 * when its life id is one of Adam's (`mind.lives`): Adam stays on his own process (decision 0050).
 */
export function parsePlayerConfig(doc: unknown, playerId: string): PlayerConfig {
  const root = record(doc, 'shard file');
  const lifeId = lifeIdForPlayer(playerId);
  if (lifeId === null) throw new Error(`player id '${playerId}' does not match the player pattern`);
  const sovereign = record(root.sovereign, 'sovereign');
  const players = Array.isArray(sovereign.players) ? sovereign.players : [];
  const entry = players
    .map((item) => record(item, 'sovereign.players[]'))
    .find((item) => item.player_id === playerId);
  if (entry === undefined) throw new Error(`player '${playerId}' is not in sovereign.players`);
  if (entry.life_id !== lifeId) {
    throw new Error(`player '${playerId}' has life_id '${String(entry.life_id)}', not '${lifeId}'`);
  }
  const adamLives = Object.values(record(record(root.mind, 'mind').lives, 'mind.lives'));
  if (adamLives.includes(lifeId)) throw new Error(`'${lifeId}' is Adam's life id, not a player`);
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw new Error(`sovereign.players entry '${playerId}' has no name`);
  }
  const presence = record(sovereign.presence, 'sovereign.presence');
  if (presence.start !== 'on_demand' && presence.start !== 'always') {
    throw new Error('sovereign.presence.start must be on_demand or always');
  }
  const start = presence.start;
  // The shard's own `mind.agent` is replaced by the player's, so `parseAdamConfig` reads the player.
  const config = parseAdamConfig({
    ...root,
    mind: { agent: { username: lifeId, name: entry.name } },
  });
  return { ...config, playerId, start };
}
