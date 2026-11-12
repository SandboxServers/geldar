export type Wear = 'low' | 'worn' | 'nearly_broken';

/**
 * The durability state of a stack, as the `wear` key of an inventory entry. Percent used, in
 * integers: worn from 50, nearly_broken from 90, low below 50. Absent for items without durability
 * (a stone block, or a stack whose durability data is missing or zero).
 */
export function wearOf(stack: object): { wear?: Wear } {
  const { maxDurability, durabilityUsed } = stack as {
    maxDurability?: unknown;
    durabilityUsed?: unknown;
  };
  if (typeof maxDurability !== 'number' || typeof durabilityUsed !== 'number') return {};
  if (maxDurability <= 0) return {};
  if (durabilityUsed * 100 >= 90 * maxDurability) return { wear: 'nearly_broken' };
  if (durabilityUsed * 100 >= 50 * maxDurability) return { wear: 'worn' };
  return { wear: 'low' };
}
