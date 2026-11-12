import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isNightOrStorm } from '../actions/sleep.ts';

/** Eyes sit this far above the feet (the standing eye height). */
const EYE_HEIGHT = 1.62;

/** Night takes this many levels off the sky light at the head (vanilla's darkest sky darkening). */
export const NIGHT_SKY_DARKEN = 11;

/**
 * The raw light level at the Body's head, 0 to 15: the brighter of block light and sky light, with
 * the sky light lowered at night. Null when the Body has no entity or the cell is not loaded. Reflexes
 * read this number; perception turns it into a word for the Mind.
 */
export function lightAtHead(bot: Bot): number | null {
  if (!bot.entity) return null;
  const feet = bot.entity.position;
  const block = bot.blockAt(
    new Vec3(Math.floor(feet.x), Math.floor(feet.y + EYE_HEIGHT), Math.floor(feet.z)),
  );
  if (!block) return null;
  const blockLight = typeof block.light === 'number' ? block.light : null;
  const skyLight = typeof block.skyLight === 'number' ? block.skyLight : null;
  if (blockLight === null && skyLight === null) return null;
  const night = isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0);
  const sky = (skyLight ?? 0) - (night ? NIGHT_SKY_DARKEN : 0);
  return Math.min(15, Math.max(0, blockLight ?? 0, sky));
}
