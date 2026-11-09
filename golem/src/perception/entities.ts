import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { compass } from './blocks-summary.ts';
import { canSeePoint } from './notable-blocks.ts';

type Surroundings = Snapshot['surroundings'];

/** How far the Body sees entities and other players, in blocks. */
export const ENTITY_RANGE = 24;
/** The most entities and the most agents in one snapshot, nearest first. */
export const MAX_ENTITIES = 32;
export const MAX_AGENTS = 16;

/** The fields of a Mineflayer entity read here. */
interface SeenEntity {
  type?: string;
  name?: string;
  username?: string;
  position: Vec3;
  height?: number;
  heldItem?: { name?: string } | null;
}

const KIND = /^[a-z_]{1,64}$/;
const ITEM = /^[a-z0-9_]{1,64}$/;

function byDistance<T extends { distance: number }>(a: T, b: T, nameA: string, nameB: string) {
  return a.distance - b.distance || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
}

/** Distance to one decimal, so the sentence a prompt builds from it is byte-stable. */
function tenths(distance: number): number {
  return Math.round(distance * 10) / 10;
}

/**
 * The entities and the other players the agent sees: within `ENTITY_RANGE` and with a clear line
 * from the eyes to the middle of the body. Nothing out of sight is reported. Players go to
 * `agents` (name, distance, held item, health unknown) and everything else to `entities`.
 */
export function observeEntities(bot: Bot): Pick<Surroundings, 'entities' | 'agents'> {
  const here = bot.entity.position;
  const entities: (Surroundings['entities'][number] & { sort: string })[] = [];
  const agents: (Surroundings['agents'][number] & { sort: string })[] = [];
  for (const entity of Object.values(bot.entities) as SeenEntity[]) {
    if (entity === (bot.entity as unknown as SeenEntity)) continue;
    const distance = here.distanceTo(entity.position);
    if (distance > ENTITY_RANGE) continue;
    const body = entity.position.offset(0, (entity.height ?? 1) / 2, 0);
    if (!canSeePoint(bot, body)) continue;
    if (entity.type === 'player') {
      const name = entity.username ?? '';
      if (name.length < 1 || name.length > 32 || name === bot.username) continue;
      const held = entity.heldItem?.name;
      agents.push({
        name,
        distance: tenths(distance),
        held_item: held && ITEM.test(held) ? held : null,
        health_estimate: 'unknown',
        sort: name,
      });
      continue;
    }
    const kind = entity.name ?? '';
    if (!KIND.test(kind)) continue;
    entities.push({
      type: kind,
      distance: tenths(distance),
      direction: compass(entity.position.x - here.x, entity.position.z - here.z),
      sort: kind,
    });
  }
  entities.sort((a, b) => byDistance(a, b, a.sort, b.sort));
  agents.sort((a, b) => byDistance(a, b, a.sort, b.sort));
  return {
    entities: entities.slice(0, MAX_ENTITIES).map(({ sort: _sort, ...rest }) => rest),
    agents: agents.slice(0, MAX_AGENTS).map(({ sort: _sort, ...rest }) => rest),
  };
}
