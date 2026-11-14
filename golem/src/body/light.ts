import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isNightOrStorm } from '../actions/sleep.ts';

/** Eyes sit this far above the feet (the standing eye height). */
const EYE_HEIGHT = 1.62;

/** Night takes this many levels off the sky light at the head (vanilla's darkest sky darkening). */
export const NIGHT_SKY_DARKEN = 11;

/** The lowest block height of the overworld, the default when a column does not say. */
const WORLD_MIN_Y = -64;

/** The part of a chunk column the light read looks at: its section list, when it has one, and its lowest height. */
interface ColumnShape {
  sections?: unknown;
  minY?: number;
}

/**
 * The raw light level at the Body's head, 0 to 15: the brighter of block light and sky light, with
 * the sky light lowered at night. Null when the Body has no entity, the cell is not loaded, or the
 * section holding the cell is not loaded (its light is unknown, not dark). Reflexes read this
 * number; perception turns it into a word for the Mind.
 */
export function lightAtHead(bot: Bot): number | null {
  if (!bot.entity) return null;
  const feet = bot.entity.position;
  const head = new Vec3(Math.floor(feet.x), Math.floor(feet.y + EYE_HEIGHT), Math.floor(feet.z));
  const block = bot.blockAt(head);
  if (!block) return null;
  if (!sectionLoaded(bot, head)) return null;
  const blockLight = typeof block.light === 'number' ? block.light : null;
  const skyLight = typeof block.skyLight === 'number' ? block.skyLight : null;
  if (blockLight === null && skyLight === null) return null;
  const night = isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0);
  const sky = (skyLight ?? 0) - (night ? NIGHT_SKY_DARKEN : 0);
  return Math.min(15, Math.max(0, blockLight ?? 0, sky));
}

/**
 * False when the chunk section holding `cell` is not loaded. prismarine-chunk reads a cell in an
 * unloaded section as light 0, which would read as pitch dark, so the section entry of the column
 * decides. A column with no section list is taken as loaded (the block itself came back), and a
 * world with no column read at all is taken as loaded too.
 */
function sectionLoaded(bot: Bot, cell: Vec3): boolean {
  const world = bot.world as unknown as
    | { getColumnAt?: (at: Vec3) => ColumnShape | null | undefined }
    | undefined;
  if (!world || typeof world.getColumnAt !== 'function') return true;
  const column = world.getColumnAt(cell);
  if (!column) return false;
  if (!Array.isArray(column.sections)) return true;
  const index = Math.floor((cell.y - (column.minY ?? WORLD_MIN_Y)) / 16);
  const section: unknown = column.sections[index];
  return section !== undefined && section !== null;
}
