import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { canSeeBody } from './body-sight.ts';
import { ENTITY_RANGE } from './entities.ts';

/** The fields of a visible agent the actions read. */
export interface VisibleAgent {
  username: string;
  position: Vec3;
  height: number;
  distance: number;
}

/**
 * A player entity as the loaded world lists it. `displayName` is deliberately absent: on a real
 * mineflayer player entity it is the registry type name (`'Player'`), never the player's name.
 */
interface PlayerEntity {
  type?: string;
  username?: string;
  position: Vec3;
  height?: number;
}

/** A tab-list entry: mineflayer's `bot.players[username]`, whose `displayName` is a ChatMessage. */
interface ListedPlayer {
  displayName?: { toString(): string };
}

/**
 * Words that name no particular player: the registry type name and mineflayer's placeholder. A loose
 * name that is one of these never resolves, even when a single visible player is in sight.
 */
const GENERIC_NAMES = new Set(['player', 'unknown']);

/** The loaded players other than the Body itself. */
function otherPlayers(bot: Bot): PlayerEntity[] {
  return (Object.values(bot.entities) as PlayerEntity[]).filter(
    (entity) =>
      entity.type === 'player' &&
      entity.username !== bot.username &&
      entity !== (bot.entity as unknown as PlayerEntity),
  );
}

/**
 * The in-world display name of a loaded player, in plain text, from the tab list
 * (`bot.players[username].displayName`, mineflayer's `lib/plugins/entities.js:638`). Null when the
 * tab list has no entry for the username or the entry has no display name.
 */
function listedDisplayName(bot: Bot, username: string | undefined): string | null {
  if (!username) return null;
  const listed = (bot.players as Record<string, ListedPlayer | undefined> | undefined)?.[username];
  const text = listed?.displayName?.toString();
  return text ? text : null;
}

/**
 * The visible view of one loaded player: within `ENTITY_RANGE` and with some part of the body in
 * sight (`canSeeBody`, the same rule `observeEntities` uses). Null when it is not visible.
 */
function visibleView(bot: Bot, entity: PlayerEntity): VisibleAgent | null {
  const distance = bot.entity.position.distanceTo(entity.position);
  if (distance > ENTITY_RANGE) return null;
  const height = entity.height ?? 1;
  if (!canSeeBody(bot, entity.position, height)) return null;
  return { username: entity.username ?? '', position: entity.position, height, distance };
}

/** The username without the `ag_` life prefix: the handle an agent is known by. */
function handleOf(username: string): string {
  return username.replace(/^ag_/, '');
}

/**
 * Whether `name` is a loose spelling of this player: their handle without the `ag_` prefix, or their
 * in-world display name from the tab list, compared case-insensitively.
 */
function namedLoosely(bot: Bot, entity: PlayerEntity, name: string): boolean {
  const wanted = name.toLowerCase();
  if (entity.username && handleOf(entity.username).toLowerCase() === wanted) return true;
  const shown = listedDisplayName(bot, entity.username);
  return shown !== null && shown.toLowerCase() === wanted;
}

/**
 * Whether the exact username `username` is a loaded player the agent can see now: the same rule as
 * `findVisibleAgent`, with no loose matching. The bystander names in a give's outcome use this, so an
 * unseen player is never named because a visible agent shares their handle (decision 0145).
 */
export function isUsernameVisible(bot: Bot, username: string): boolean {
  return otherPlayers(bot).some(
    (entity) => entity.username === username && visibleView(bot, entity) !== null,
  );
}

/**
 * The player called `name` if, and only if, the agent can see them now: a loaded player entity
 * within `ENTITY_RANGE` and with a clear line from the eyes to the middle of the body (the same
 * rule `observeEntities` uses for the snapshot's `agents`). Null otherwise, and the caller must
 * not tell "not in sight" from "does not exist": the name is never looked up in `bot.players` to
 * find a player, which lists every player on the server (decisions 0058 and 0068, the knowledge
 * boundary). `bot.players` is read only for a visible player's own username, to get their tab-list
 * display name.
 *
 * A `name` that is an exact username of a loaded player is resolved only to that player. Any other
 * `name` (decision 0334) is resolved loosely, only among the players already visible: their handle
 * without `ag_`, or their in-world display name. The generic words in `GENERIC_NAMES` never match.
 * It resolves only when exactly one visible player matches; two matches, or none, return null
 * exactly as an unseen or unknown name does (decision 0145).
 */
export function findVisibleAgent(bot: Bot, name: string): VisibleAgent | null {
  const players = otherPlayers(bot);
  const exact = players.filter((entity) => entity.username === name);
  if (exact.length > 0) {
    for (const entity of exact) {
      const view = visibleView(bot, entity);
      if (view) return view;
    }
    return null;
  }
  if (GENERIC_NAMES.has(name.toLowerCase())) return null;
  const matches: VisibleAgent[] = [];
  for (const entity of players) {
    if (!namedLoosely(bot, entity, name)) continue;
    const view = visibleView(bot, entity);
    if (view) matches.push(view);
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
