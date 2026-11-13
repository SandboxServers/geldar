import type { Bot } from 'mineflayer';

/**
 * The player half-width the server uses. The server builds the player box with
 * `EntityDimensions.makeBoundingBox`, which takes the 0.6 width as a float and halves it, so the
 * half-width is 0.30000001192092896. prismarine-physics assumes exactly 0.3. Paper's movement check
 * has no tolerance for full blocks, so a client flush against a block face is 1.19e-8 inside that
 * block on the server and is rolled back ("CLIPPED_INTO_BLOCK") again and again.
 */
export const SERVER_HALF_WIDTH = Math.fround(0.6) / 2;

/** prismarine-physics' object: the typings of mineflayer's `bot.physics` do not declare the field. */
interface HalfWidthPhysics {
  playerHalfWidth: number;
}

const matched = new WeakSet<Bot>();

function setHalfWidth(physics: object): void {
  (physics as HalfWidthPhysics).playerHalfWidth = SERVER_HALF_WIDTH;
}

/**
 * Sets the client's hitbox to the server's. mineflayer assigns `bot.physics` while it injects its
 * plugins, on `inject_allowed`, so the value is set at once when the physics object already exists
 * and otherwise on that event. Idempotent per bot.
 */
export function matchServerHitbox(bot: Bot): void {
  if (matched.has(bot)) return;
  matched.add(bot);
  if (bot.physics) {
    setHalfWidth(bot.physics);
    return;
  }
  bot.once('inject_allowed', () => {
    if (bot.physics) setHalfWidth(bot.physics);
  });
}
