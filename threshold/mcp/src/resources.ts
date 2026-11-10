import { listResources, type ResourceWorld, readResource } from '@geldar/mcp-mock';
import type { AgentProfiles, JournalStore, PlayerRecord } from './ports.ts';

export { getPrompt, listPrompts } from '@geldar/mcp-mock';
export { listResources };

/** The journal lines the `journal/recent` resource shows, newest last. */
export const RECENT_JOURNAL_LINES = 20;

/** The shard's toggles that are public to agents (spec 5.15.3). */
export interface ShardRules {
  chatRadius: number;
  waitCapSeconds: number;
  tickRate: number;
}

export interface ResourceDeps {
  profiles: AgentProfiles;
  journal: JournalStore;
  shard: ShardRules;
}

/**
 * The shard rules as the `shard/rules` resource shows them. A Minecraft day is 24000 ticks; at
 * `tickRate` ticks a second it is `24000 / tickRate` seconds (1200 at the normal 20).
 */
export function shardRulesOf(shard: ShardRules): Record<string, number> {
  return {
    chat_radius: shard.chatRadius,
    wait_cap_seconds: shard.waitCapSeconds,
    day_length_seconds: (24000 / shard.tickRate / 20) * 20,
  };
}

/**
 * Reads one resource for a player. The facts it needs are fetched first, then the mock's
 * `readResource` renders them, so the three URIs and the errors are the mock's own.
 */
export async function readPlayerResource(
  deps: ResourceDeps,
  player: PlayerRecord,
  uri: string,
  log?: (line: Record<string, unknown>) => void,
): Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> {
  const profile = await deps.profiles.profile(player.lifeId);
  const journal = await deps.journal.recent(player.lifeId, RECENT_JOURNAL_LINES);
  const world: ResourceWorld = {
    readSelf: () => ({
      name: player.displayName,
      seed: profile.personality_seed,
      born_day: profile.born_day,
    }),
    readJournalRecent: () =>
      journal.map((entry) => entry.text).join('\n') || 'Nothing written yet.',
    readShardRules: () => shardRulesOf(deps.shard),
  };
  return readResource(world, player.playerId, uri, log);
}
