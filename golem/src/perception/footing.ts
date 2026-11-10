import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** The blocks at the feet and at the head, by name: what the Body stands on and what is over it. */
export interface Footing {
  standing_on?: string;
  block_above_feet?: string;
}

/**
 * The name of the block under the feet (floor of y minus 1) and of the block at the head (floor of
 * y plus 1). Air is a name like any other. A name is left out when its chunk is not loaded.
 */
export function footing(bot: Bot): Footing {
  const { position } = bot.entity;
  const x = Math.floor(position.x);
  const z = Math.floor(position.z);
  const feet = Math.floor(position.y);
  const out: Footing = {};
  const under = bot.blockAt(new Vec3(x, feet - 1, z));
  if (under) out.standing_on = under.name;
  const head = bot.blockAt(new Vec3(x, feet + 1, z));
  if (head) out.block_above_feet = head.name;
  return out;
}
