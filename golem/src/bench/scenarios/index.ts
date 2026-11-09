// biome-ignore-all assist/source/organizeImports: each packet's imports stay in its own block, in packet order
import type { Scenario } from '../types.ts';

// The scenario registry: P0-10a, P0-10b and P0-10c each fill only their own marked block, in the
// import list and in the array. A merge conflict here is mechanical: keep every block. Keep each
// packet's imports inside its block, in place.

// --- P0-10a goto-smoke ---
import { gotoSmoke } from './goto-smoke.ts';

// --- P0-10b wood-to-stone-tools, food, shelter ---
import { food } from './food.ts';
import { woodToStoneTools } from './wood-to-stone-tools.ts';

// --- P0-10c bed, chest, blocked-path ---

/** Every scenario. `all` means every one without `hidden`. */
export const scenarios: Scenario[] = [
  // --- P0-10a goto-smoke ---
  gotoSmoke,
  // --- end P0-10a ---

  // --- P0-10b wood-to-stone-tools, food, shelter ---
  woodToStoneTools,
  food,
  // --- end P0-10b ---

  // --- P0-10c bed, chest, blocked-path ---
  // --- end P0-10c ---
];

/** The scenarios `all` runs: everything not hidden. */
export function visibleScenarios(): Scenario[] {
  return scenarios.filter((scenario) => !scenario.hidden);
}

/** The scenario with this name, or undefined. */
export function findScenario(name: string): Scenario | undefined {
  return scenarios.find((scenario) => scenario.name === name);
}
