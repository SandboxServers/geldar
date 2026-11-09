// biome-ignore-all assist/source/organizeImports: each packet's imports stay in its own block, in packet order
import { ActionRegistry, type AnyActionHandler } from './registry.ts';

// The registry file: each action packet fills only its own marked block, in the import list and
// in the array. A merge conflict here is mechanical: keep every block. Keep each packet's imports
// inside its block, in place: Biome's import sorting would move a marker and its import apart.

// --- P0-08a goto, mine ---
import { gotoAction } from './goto.ts';
import { mineAction } from './mine.ts';

// --- P0-08b craft ---
import { craftAction } from './craft.ts';

// --- P0-09a place, eat, sleep ---
import { eatHandler } from './eat.ts';
import { placeHandler } from './place.ts';
import { sleepHandler } from './sleep.ts';

// --- P0-09b open, deposit, withdraw ---
// (imports for this block go here)

/** Every action handler the Body registers. Each action packet adds its handlers to its block. */
export const allActions: AnyActionHandler[] = [
  // --- P0-08a goto, mine ---
  gotoAction,
  mineAction,
  // --- end P0-08a ---
  // --- P0-08b craft ---
  craftAction,
  // --- end P0-08b ---
  // --- P0-09a place, eat, sleep ---
  placeHandler,
  eatHandler,
  sleepHandler,
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
