import type { Bot } from 'mineflayer';

/** A full breath on the 0-20 scale (mineflayer's scale for `bot.oxygenLevel`). */
const FULL_BREATH = 20;
/** Ticks per point of air: the server counts 0-300 ticks, mineflayer shows 0-20. */
const TICKS_PER_POINT = 15;
/** The air-supply index on the base Entity class, used when the registry has no key list. */
const AIR_SUPPLY_INDEX = 1;

/** The metadata index of `air_supply` for the bot's own entity type, as mineflayer maps it. */
function airIndex(bot: Bot): number {
  const byName = bot.registry?.entitiesByName as
    | Record<string, { metadataKeys?: string[] } | undefined>
    | undefined;
  const keys = byName?.[bot.entity?.name ?? 'player']?.metadataKeys;
  const index = keys?.indexOf('air_supply') ?? -1;
  return index >= 0 ? index : AIR_SUPPLY_INDEX;
}

/**
 * The bot's own air on the 0-20 scale, read from its own entity metadata.
 * `bot.oxygenLevel` is not used: mineflayer sets it from whichever entity's metadata arrived last.
 * Falls back to a full breath when the metadata has no air value.
 */
export function ownAir(bot: Bot): number {
  const ticks: unknown = bot.entity?.metadata?.[airIndex(bot)];
  if (typeof ticks !== 'number') return FULL_BREATH;
  const points = Math.round(ticks / TICKS_PER_POINT);
  return Math.min(FULL_BREATH, Math.max(0, points));
}
