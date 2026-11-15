import type { Vec3 } from 'vec3';
import type { ActionContext } from './registry.ts';

type Bot = ActionContext['bot'];

/** The horizontal reach of the water check, in blocks: vanilla hydration looks at a 9 by 2 by 9 box. */
const WATER_REACH = 4;

/** The fixed fact texts for a farmland block (decision 0154: facts, never advice). */
export const FARMLAND_FACT = {
  moist: 'this farmland is moist: water is within 4 blocks',
  dry: 'this farmland is dry: no water within 4 blocks',
} as const;

/**
 * The hydration fact for the farmland block at `farmland`. Vanilla hydrates farmland from water within
 * 4 blocks horizontally, at its height or one above, so the box scanned is 9 by 2 by 9. Any water in
 * the box makes it moist. With no water seen and a cell of the box not loaded, there is no fact
 * (undefined): the answer would be a guess.
 */
export function farmlandFact(bot: Bot, farmland: Vec3): string | undefined {
  let unloaded = false;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -WATER_REACH; dx <= WATER_REACH; dx++) {
      for (let dz = -WATER_REACH; dz <= WATER_REACH; dz++) {
        const cell = bot.blockAt(farmland.offset(dx, dy, dz));
        if (!cell) {
          unloaded = true;
        } else if (cell.name === 'water') {
          return FARMLAND_FACT.moist;
        }
      }
    }
  }
  return unloaded ? undefined : FARMLAND_FACT.dry;
}
