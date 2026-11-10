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
 * Maps one thoughts.snapshot JSONB value to a LiteSnapshot. A field of an unknown shape becomes
 * null (or is dropped from the inventory), so a missing value is never read as a number.
 */
export function toLiteSnapshot(raw: unknown): LiteSnapshot | null {
  if (!isRecord(raw)) return null;
  const hunger = typeof raw.hunger === 'number' && Number.isFinite(raw.hunger) ? raw.hunger : null;
  const heldItem = typeof raw.heldItem === 'string' ? raw.heldItem : null;
  const inventory: { item: string; count: number }[] = [];
  if (Array.isArray(raw.inventory)) {
    for (const slot of raw.inventory) {
      if (isRecord(slot) && typeof slot.item === 'string' && typeof slot.count === 'number') {
        inventory.push({ item: slot.item, count: slot.count });
      }
    }
  }
  return { hunger, heldItem, inventory };
}
