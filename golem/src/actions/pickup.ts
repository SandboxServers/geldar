import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { type ItemStack, inventoryDelta } from './mine.ts';
import { moveNear } from './pathing.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext } from './registry.ts';

// The pickup follows Mindcraft's pickupNearbyItems (MIT, see THIRD_PARTY_NOTICES.md). The code is ours.

/** The entity type Mineflayer hands out in `bot.entities`. */
type Entity = Bot['entities'][string];

/** Drops within this many blocks of the spot where the drops appeared are picked up. */
export const PICKUP_RADIUS = 4;
/** Ticks a drop gets to appear after its break or death, before timeScale. */
const SPAWN_TICKS = 10;
/** Most walks one pickup makes, one per drop. */
const PICKUP_WALKS = 6;
/** Wall-clock bound on the whole pickup, before timeScale. */
const PICKUP_MS = 3000;
/** Ticks the bot waits after a walk for the `playerCollect` event, before timeScale. */
const COLLECT_TICKS = 4;
/** The walk ends on the drop's own cell: close enough to take it. */
const PICKUP_RANGE = 1;
/** Liquids a drop is not chased through. */
const LIQUIDS = new Set(['water', 'lava']);

export interface PickupOutcome {
  /** Item names the inventory gained during the pickup, in the order of the inventory. */
  picked: string[];
  /** Whether a drop still lies within `PICKUP_RADIUS` after the pickup. */
  left: boolean;
  /** Whether the signal aborted while the pickup ran. */
  aborted: boolean;
}

/** The item entities within `PICKUP_RADIUS` of `origin`, nearest first. */
function dropsNear(bot: Bot, origin: Vec3): Entity[] {
  return Object.values(bot.entities)
    .filter(
      (entity) =>
        entity.name === 'item' &&
        entity.isValid !== false &&
        entity.position.distanceTo(origin) <= PICKUP_RADIUS,
    )
    .sort((a, b) => a.position.distanceTo(origin) - b.position.distanceTo(origin));
}

/** Whether the drop lies in water or lava: such a drop is not chased. */
function inLiquid(bot: Bot, at: Vec3): boolean {
  const name = bot.blockAt(at.floored())?.name;
  return name !== undefined && LIQUIDS.has(name);
}

/**
 * Walks the bot to the item drops near `origin` and takes them, nearest first. Drops appear a few
 * ticks after the break or death, so the pickup waits briefly for them. Each walk is confirmed by
 * Mineflayer's `playerCollect` event for the bot. Drops in water or lava are not chased. The whole
 * pickup is bounded by `PICKUP_MS` and `PICKUP_WALKS`, and it stops at once on abort. What the bot
 * gained is read from the inventory against `start`.
 */
export async function pickUpDrops(
  ctx: ActionContext,
  origin: Vec3,
  start: ItemStack[],
): Promise<PickupOutcome> {
  const { bot, signal, timeScale } = ctx;
  const deadline = Date.now() + PICKUP_MS * timeScale;
  const tried = new Set<number>();
  const candidates = (): Entity[] =>
    dropsNear(bot, origin).filter(
      (entity) => !tried.has(entity.id) && !inLiquid(bot, entity.position),
    );
  let collects = 0;
  const onCollect = (collector: Entity): void => {
    if (collector === bot.entity) collects += 1;
  };
  bot.on('playerCollect', onCollect);
  try {
    await pollUntil(bot, signal, () => candidates().length > 0, {
      polls: Math.ceil(SPAWN_TICKS * timeScale),
    });
    for (let walks = 0; walks < PICKUP_WALKS && !signal.aborted && Date.now() < deadline; walks++) {
      const [drop] = candidates();
      if (!drop) break;
      tried.add(drop.id);
      const before = collects;
      const walk = await moveNear(bot, drop.position, PICKUP_RANGE, { signal, timeScale });
      if (!walk.ok && walk.reason === 'cancelled') break;
      await pollUntil(bot, signal, () => collects > before, {
        polls: Math.ceil(COLLECT_TICKS * timeScale),
      });
    }
  } finally {
    bot.removeListener('playerCollect', onCollect);
  }
  return {
    picked: Object.keys(inventoryDelta(start, bot.inventory.items())),
    left: dropsNear(bot, origin).length > 0,
    aborted: signal.aborted,
  };
}

/**
 * The plain-words report of a pickup: "picked up beef", "drops were left on the ground", or both.
 * Null when there was nothing to report.
 */
export function pickupNote(outcome: PickupOutcome): string | null {
  const parts: string[] = [];
  if (outcome.picked.length > 0) parts.push(`picked up ${outcome.picked.join(', ')}`);
  if (outcome.left) parts.push('drops were left on the ground');
  return parts.length > 0 ? parts.join('; ') : null;
}
