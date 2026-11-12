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
  position: Vec3;
  height?: number;
}

/**
 * The player called `name` if, and only if, the agent can see them now: a loaded player entity
 * within `ENTITY_RANGE` and with a clear line from the eyes to the middle of the body (the same
 * rule `observeEntities` uses for the snapshot's `agents`). Null otherwise, and the caller must
 * not tell "not in sight" from "does not exist": the name is never looked up in `bot.players`,
 * which lists every player on the server (decisions 0058 and 0068, the knowledge boundary).
 */
export function findVisibleAgent(bot: Bot, name: string): VisibleAgent | null {
  const here = bot.entity.position;
  for (const entity of Object.values(bot.entities) as PlayerEntity[]) {
    if (entity.type !== 'player' || entity.username !== name) continue;
    if (name === bot.username || entity === (bot.entity as unknown as PlayerEntity)) continue;
    const distance = here.distanceTo(entity.position);
    if (distance > ENTITY_RANGE) continue;
    const height = entity.height ?? 1;
    if (!canSeePoint(bot, entity.position.offset(0, height / 2, 0))) continue;
    return { username: name, position: entity.position, height, distance };
  }
  return null;
}
