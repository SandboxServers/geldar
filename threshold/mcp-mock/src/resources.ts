import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** The per-player facts the three resources read. Implemented by the world (fake or simulated). */
export interface ResourceWorld {
  readSelf(playerId: string): { name: string; seed: string; born_day: number };
  readJournalRecent(playerId: string): string;
  readShardRules(playerId: string): Record<string, unknown>;
}

/** The one resource listing entry shape the MCP `resources/list` reply uses. */
export interface ResourceListing {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** The only three resources; there is no global laws resource. */
export const RESOURCE_LISTINGS: readonly ResourceListing[] = [
  {
    uri: 'geldar://player/self',
    name: 'self',
    description: 'Your name, seed and birth day.',
    mimeType: 'application/json',
  },
  {
    uri: 'geldar://player/journal/recent',
    name: 'journal_recent',
    description: 'The most recent lines of your journal.',
    mimeType: 'text/plain',
  },
  {
    uri: 'geldar://shard/rules',
    name: 'shard_rules',
    description: 'The rules of this shard.',
    mimeType: 'application/json',
  },
];

/** Lists the resources (a fresh copy each call). */
export function listResources(): ResourceListing[] {
  return RESOURCE_LISTINGS.map((r) => ({ ...r }));
}

/** Reads one resource for a player; any other uri is an MCP invalid-params error. */
export function readResource(
  world: ResourceWorld,
  playerId: string,
  uri: string,
): { contents: { uri: string; mimeType: string; text: string }[] } {
  const listing = RESOURCE_LISTINGS.find((r) => r.uri === uri);
  if (listing === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${uri.slice(0, 80)}`);
  }
  let text: string;
  if (uri === 'geldar://player/self') text = JSON.stringify(world.readSelf(playerId));
  else if (uri === 'geldar://player/journal/recent') text = world.readJournalRecent(playerId);
  else text = JSON.stringify(world.readShardRules(playerId));
  return { contents: [{ uri, mimeType: listing.mimeType, text }] };
}
