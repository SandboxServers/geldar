// biome-ignore-all assist/source/organizeImports: each packet's imports stay in its own block, in packet order
import { ActionRegistry, type AnyActionHandler } from './registry.ts';

// The registry file: each action packet fills only its own marked block, in the import list and
// in the array. A merge conflict here is mechanical: keep every block. Keep each packet's imports
// inside its block, in place: Biome's import sorting would move a marker and its import apart.

// --- P0-08a goto, mine ---
// (imports for this block go here)

// --- P0-08b craft ---
// (imports for this block go here)

// --- P0-09a place, eat, sleep ---
// (imports for this block go here)

// --- P0-09b open, deposit, withdraw ---
// (imports for this block go here)

/** Every action handler the Body registers. Each action packet adds its handlers to its block. */
export const allActions: AnyActionHandler[] = [
  // --- P0-08a goto, mine ---
  // (handlers for P0-08a go here)
  // --- end P0-08a ---
  // --- P0-08b craft ---
  // (handlers for P0-08b go here)
  // --- end P0-08b ---
  // --- P0-09a place, eat, sleep ---
  // (handlers for P0-09a go here)
  // --- end P0-09a ---
  // --- P0-09b open, deposit, withdraw ---
  // (handlers for P0-09b go here)
  // --- end P0-09b ---
];

/** A registry with every handler in `allActions` registered. */
export function createRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  for (const handler of allActions) registry.register(handler);
  return registry;
}
