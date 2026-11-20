// CAP-5: the enchanting-table offers fill in after the sword and lapis are placed. This waits, one tick at a time and
// at most ENCHANT_OFFER_MAX_TICKS, for any offered level above 0. It is informational: the case never fails on it.

export const ENCHANT_OFFER_MAX_TICKS = 40;

export interface EnchantOfferWait {
  /** The levels read last (-1 means the server has not offered that option yet). */
  levels: number[];
  /** True when at least one offered level is above 0. */
  populated: boolean;
  /** How many ticks were waited before the last read (0 when the first read was already populated). */
  ticks: number;
}

/**
 * Reads the offered levels, and while none is above 0 waits one tick and reads again, up to `maxTicks` waits.
 * A failing tick wait propagates; the offers are never invented.
 */
export async function waitForEnchantOffers(
  readLevels: () => readonly number[],
  waitOneTick: () => Promise<void>,
  maxTicks: number = ENCHANT_OFFER_MAX_TICKS,
): Promise<EnchantOfferWait> {
  let levels = [...readLevels()];
  for (let ticks = 0; ; ticks++) {
    if (levels.some((level) => level > 0)) return { levels, populated: true, ticks };
    if (ticks >= maxTicks) return { levels, populated: false, ticks };
    await waitOneTick();
    levels = [...readLevels()];
  }
}
