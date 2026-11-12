// The Body's side of the viewport: reads the bot into a render scene. Only what the Body has loaded
// and can see goes in: loaded blocks (bot.blockAt), the eye and the look, and entities that the
// perception line-of-sight rule already judges in sight. No names, no coordinates leave this file.

import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ENTITY_RANGE, MAX_ENTITIES } from '../perception/entities.ts';
import { canSeePoint, eyePosition } from '../perception/notable-blocks.ts';
import type { ViewportEntity } from '../viewport/index.ts';
import { type BlockSnapshot, copyBlockBox } from './snapshot.ts';

/** The render worker's input: a block snapshot plus the eye, the look and the entities in sight. */
export interface RenderScene {
  snapshot: BlockSnapshot;
  eye: { x: number; y: number; z: number };
  /** Radians, mineflayer convention. */
  yaw: number;
  pitch: number;
  entities: ViewportEntity[];
  /** The image size, already clamped (see image-size.ts). */
  width: number;
  height: number;
}

/** The fallback height of an entity whose box mineflayer does not report. */
const DEFAULT_HEIGHT = 1.8;
const DEFAULT_WIDTH = 0.6;

/** Whether the cell holding the eye is loaded. False means the Body cannot draw anything. */
export function eyeCellLoaded(bot: Bot): boolean {
  return bot.blockAt(eyePosition(bot).floored()) !== null;
}

/** The block name at each cell, or null for a cell the Body has not loaded. */
function blockName(bot: Bot, x: number, y: number, z: number): string | null {
  const block = bot.blockAt(new Vec3(x, y, z));
  return block === null ? null : block.name;
}

/** The entities the Body can see: within the perception range and with a clear line to the body centre. */
export function entitiesInSight(bot: Bot): ViewportEntity[] {
  const me = bot.entity as { position: Vec3 } | undefined;
  if (me === undefined) return [];
  const sighted: { entity: ViewportEntity; distance: number }[] = [];
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const position = entity.position as Vec3 | undefined;
    if (position === undefined) continue;
    const distance = position.distanceTo(me.position);
    if (distance > ENTITY_RANGE) continue;
    const height = entity.height ?? DEFAULT_HEIGHT;
    const width = entity.width ?? DEFAULT_WIDTH;
    if (!canSeePoint(bot, position.offset(0, height / 2, 0))) continue;
    sighted.push({
      entity: { type: entity.type, x: position.x, y: position.y, z: position.z, width, height },
      distance,
    });
  }
  sighted.sort((a, b) => a.distance - b.distance);
  return sighted.slice(0, MAX_ENTITIES).map((s) => s.entity);
}

/**
 * The render scene for the bot's view at the size asked. The caller checks `eyeCellLoaded` first;
 * the copied box is SNAPSHOT_RADIUS around the eye and the image range is capped to it.
 */
export function readBodyScene(bot: Bot, size: { width: number; height: number }): RenderScene {
  const eye = eyePosition(bot);
  const snapshot = copyBlockBox((x, y, z) => blockName(bot, x, y, z), eye);
  return {
    snapshot,
    eye: { x: eye.x, y: eye.y, z: eye.z },
    yaw: bot.entity.yaw,
    pitch: bot.entity.pitch,
    entities: entitiesInSight(bot),
    width: size.width,
    height: size.height,
  };
}
