import {
  listResources,
  getPrompt as mockPrompt,
  type ResourceWorld,
  readResource,
} from '@geldar/mcp-mock';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type {
  AgentProfile,
  AgentProfiles,
  JournalEntry,
  JournalStore,
  PlayerRecord,
} from './ports.ts';

export { listPrompts } from '@geldar/mcp-mock';
export { listResources };

/** The journal lines the `journal/recent` resource shows, newest last. */
export const RECENT_JOURNAL_LINES = 20;

/** What a player reads when a resource read fails: neutral, with no word about the world's nature. */
export const PLAYER_FAULT = 'something went wrong; try again';

/** The cause of a failure as one log field: the error's name and message, or its string form. */
export function causeOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The prompt text a player reads: the mock's prompt without its stand-in suffix. */
export function getPrompt(name: string) {
  return mockPrompt(name, '');
}

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

/** The database facts one resource reads: only the URI's own, so a read costs at most one query. */
interface ResourceFacts {
  profile?: AgentProfile;
  journal: JournalEntry[];
}

/**
 * Reads one resource for a player. The one database fact the URI needs is fetched first, inside
 * a try: a failure is logged with its cause and the player reads the neutral fault. Then the
 * mock's `readResource` renders the facts, so the three URIs and the errors are the mock's own.
 */
export async function readPlayerResource(
  deps: ResourceDeps,
  player: PlayerRecord,
  uri: string,
  log?: (line: Record<string, unknown>) => void,
): Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> {
  const facts: ResourceFacts = { journal: [] };
  try {
    if (uri === 'geldar://player/self') {
      facts.profile = await deps.profiles.profile(player.lifeId);
    } else if (uri === 'geldar://player/journal/recent') {
      facts.journal = await deps.journal.recent(player.lifeId, RECENT_JOURNAL_LINES);
    }
  } catch (error) {
    log?.({
      event: 'resource_error',
      player_id: player.playerId,
      cause: `${uri}: ${causeOf(error)}`,
    });
    throw new McpError(ErrorCode.InternalError, PLAYER_FAULT);
  }
  const world: ResourceWorld = {
    readSelf: () => {
      const profile = facts.profile;
      if (profile === undefined) throw new Error('the profile was not loaded');
      return {
        name: player.displayName,
        seed: profile.personality_seed,
        born_day: profile.born_day,
      };
    },
    readJournalRecent: () =>
      facts.journal.map((entry) => entry.text).join('\n') || 'Nothing written yet.',
    readShardRules: () => shardRulesOf(deps.shard),
  };
  return readResource(world, player.playerId, uri, log, PLAYER_FAULT);
}
