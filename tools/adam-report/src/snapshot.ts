import type { Criteria, LiteSnapshot, Manifest, RunData } from './types.ts';

/**
 * Everything the pure report functions read: the manifest, the criteria and the rows already
 * loaded for one life. Nothing below this file touches the database; db.ts builds this value.
 */
export interface Snapshot {
  manifest: Manifest;
  criteria: Criteria;
  data: RunData;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Maps one thoughts.snapshot JSONB value to a LiteSnapshot. The stored value is the contract's
 * snapshot (snapshot.schema.json): the agent's own state sits under `self`, with `hunger` (integer),
 * `held_item` (an item name or null) and `inventory` (ItemStack objects with `item` and `count`).
 * A field of an unknown shape becomes null (or is dropped from the inventory), so a missing value
 * is never read as a number.
 */
export function toLiteSnapshot(raw: unknown): LiteSnapshot | null {
  if (!isRecord(raw) || !isRecord(raw.self)) return null;
  const self = raw.self;
  const hunger =
    typeof self.hunger === 'number' && Number.isFinite(self.hunger) ? self.hunger : null;
  const heldItem = typeof self.held_item === 'string' ? self.held_item : null;
  const inventory: { item: string; count: number }[] = [];
  if (Array.isArray(self.inventory)) {
    for (const slot of self.inventory) {
      if (isRecord(slot) && typeof slot.item === 'string' && typeof slot.count === 'number') {
        inventory.push({ item: slot.item, count: slot.count });
      }
    }
  }
  return { hunger, heldItem, inventory };
}
