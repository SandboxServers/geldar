import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { ENTITY_RANGE } from './entities.ts';
import { canSeePoint } from './notable-blocks.ts';

/** The fields of a visible agent the actions read. */
export interface VisibleAgent {
  username: string;
  position: Vec3;
  height: number;
  distance: number;
}

interface PlayerEntity {
  type?: string;
  username?: string;
  displayName?: string;
  position: Vec3;
  height?: number;
}

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
 * The visible view of one loaded player: within `ENTITY_RANGE` and with a clear line from the eyes
 * to the middle of the body (the same rule `observeEntities` uses). Null when it is not visible.
 */
function visibleView(bot: Bot, entity: PlayerEntity): VisibleAgent | null {
  const distance = bot.entity.position.distanceTo(entity.position);
  if (distance > ENTITY_RANGE) return null;
  const height = entity.height ?? 1;
  if (!canSeePoint(bot, entity.position.offset(0, height / 2, 0))) return null;
  return { username: entity.username ?? '', position: entity.position, height, distance };
}

/** The username without the `ag_` life prefix: the handle an agent is known by. */
function handleOf(username: string): string {
  return username.replace(/^ag_/, '');
}

/**
 * Whether `name` is a loose spelling of this player: their handle without the `ag_` prefix, or their
 * in-world display name, compared case-insensitively. Only a name that is not an exact username uses this.
 */
function namedLoosely(entity: PlayerEntity, name: string): boolean {
  const wanted = name.toLowerCase();
  if (entity.username && handleOf(entity.username).toLowerCase() === wanted) return true;
  return entity.displayName !== undefined && entity.displayName.toLowerCase() === wanted;
}

/**
 * The player called `name` if, and only if, the agent can see them now: a loaded player entity
 * within `ENTITY_RANGE` and with a clear line from the eyes to the middle of the body (the same
 * rule `observeEntities` uses for the snapshot's `agents`). Null otherwise, and the caller must
 * not tell "not in sight" from "does not exist": the name is never looked up in `bot.players`,
 * which lists every player on the server (decisions 0058 and 0068, the knowledge boundary).
 *
 * A `name` that is an exact username of a loaded player is resolved only to that player. Any other
 * `name` (decision 0334) is resolved loosely, only among the players already visible: their handle
 * without `ag_`, or their display name. It resolves only when exactly one visible player matches;
 * two matches, or none, return null exactly as an unseen or unknown name does (decision 0145).
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
  const matches: VisibleAgent[] = [];
  for (const entity of players) {
    if (!namedLoosely(entity, name)) continue;
    const view = visibleView(bot, entity);
    if (view) matches.push(view);
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
