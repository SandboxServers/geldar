import type { Vec3 } from 'vec3';
import type { ActionContext } from './registry.ts';

/** Ticks one move is tried, and the horizontal distance that counts as free. */
export const MOVE_TICKS = 24;
const FREE_DISTANCE = 1.5;

/** Heads for `dir` for up to `MOVE_TICKS` ticks; true once the bot is `FREE_DISTANCE` from where it began. */
export async function walk(ctx: ActionContext, dir: Vec3, jump: boolean): Promise<boolean> {
  const { bot } = ctx;
  const start = bot.entity.position.clone();
  try {
    await bot.lookAt(start.offset(dir.x * 4, bot.entity.height ?? 1.62, dir.z * 4), true);
    bot.setControlState('forward', true);
    bot.setControlState('jump', jump);
    for (let i = 0; i < MOVE_TICKS && !ctx.signal.aborted; i++) {
      await bot.waitForTicks(1);
      const at = bot.entity.position;
      if (Math.hypot(at.x - start.x, at.z - start.z) >= FREE_DISTANCE) return true;
    }
    return false;
  } finally {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
}
