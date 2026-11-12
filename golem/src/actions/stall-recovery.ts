import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** How long a recovery jump is held, in world ticks. */
export const JUMP_TICKS = 5;

/** Wait before the first, second and third recovery of one body (ms). Every later one waits the last step. */
export const RECOVERY_COOLDOWN_MS: readonly number[] = [30_000, 60_000, 120_000];

interface Cooldown {
  count: number;
  nextAt: number;
}

const cooldowns = new WeakMap<object, Cooldown>();

/** True when this body may start another stall recovery at `now` (ms, the caller's clock). */
export function recoveryAllowed(bot: object, now: number): boolean {
  const cooldown = cooldowns.get(bot);
  return cooldown === undefined || now >= cooldown.nextAt;
}

/** Records a recovery at `now`; the next one waits the next step of `RECOVERY_COOLDOWN_MS`. */
export function recordRecovery(bot: object, now: number): void {
  const count = cooldowns.get(bot)?.count ?? 0;
  const wait = RECOVERY_COOLDOWN_MS[Math.min(count, RECOVERY_COOLDOWN_MS.length - 1)] ?? 0;
  cooldowns.set(bot, { count: count + 1, nextAt: now + wait });
}

/**
 * A dig this young is left alone by stall recovery: a bare-handed dig of stone takes longer than the
 * stall rule's 60 ticks, and a recovery then ends it with "Digging aborted".
 */
export const DIG_GRACE_TICKS = 200;

/** True while a `bot.dig` or the pathfinder's own dig is running. */
export function isDigging(bot: Bot): boolean {
  const b = bot as unknown as {
    targetDigBlock?: unknown;
    pathfinder?: { isMining?: () => boolean };
  };
  return Boolean(b.targetDigBlock) || b.pathfinder?.isMining?.() === true;
}

/** Stops a dig in progress (a `bot.dig` target or the pathfinder's own digging). True when it stopped one. */
export function stopDigIfDigging(bot: Bot): boolean {
  const b = bot as unknown as {
    targetDigBlock?: unknown;
    stopDigging?: () => void;
    pathfinder?: { isMining?: () => boolean };
  };
  const digging = Boolean(b.targetDigBlock) || b.pathfinder?.isMining?.() === true;
  if (!digging || typeof b.stopDigging !== 'function') return false;
  b.stopDigging();
  return true;
}

/** Holds or releases the jump control. A bot without `setControlState` (a test fake) is left alone. */
export function setJump(bot: Bot, on: boolean): void {
  const b = bot as unknown as { setControlState?: (control: string, on: boolean) => void };
  if (typeof b.setControlState === 'function') b.setControlState('jump', on);
}

/** A block the body cannot walk through: a full cube. Stairs, fences and flowers do not count. */
const isCube = (block: { boundingBox?: string } | null | undefined): boolean =>
  block?.boundingBox === 'block';

/**
 * True when a solid block stands in front of the bot toward `toward`, with the cell above it and
 * the cell above the bot's head free: a one-block step that a jump clears.
 */
export function pressedAgainstStep(bot: Bot, toward: { x: number; z: number }): boolean {
  const b = bot as unknown as {
    blockAt?: (pos: Vec3) => { boundingBox?: string } | null | undefined;
    entity?: { position?: Vec3 };
  };
  const at = b.entity?.position;
  if (!at || typeof b.blockAt !== 'function') return false;
  const dx = toward.x - at.x;
  const dz = toward.z - at.z;
  const sx = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
  const sz = sx === 0 ? Math.sign(dz) : 0;
  if (sx === 0 && sz === 0) return false;
  const fx = Math.floor(at.x);
  const fy = Math.floor(at.y);
  const fz = Math.floor(at.z);
  const cell = (x: number, y: number, z: number) => b.blockAt?.(new Vec3(x, y, z));
  return (
    isCube(cell(fx + sx, fy, fz + sz)) &&
    !isCube(cell(fx + sx, fy + 1, fz + sz)) &&
    !isCube(cell(fx, fy + 2, fz))
  );
}

/** Starts a recovery jump when the bot is pressed against a one-block step. True when it jumped. */
export function pulseJump(bot: Bot, toward: { x: number; z: number }): boolean {
  if (!pressedAgainstStep(bot, toward)) return false;
  setJump(bot, true);
  return true;
}
