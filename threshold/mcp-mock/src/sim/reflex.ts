/** The one scripted reflex: eat when hungry. No clock, no model. */

/** Food points one meal gives. */
const MEAL_FOOD = 6;
/** The highest food level. */
const MAX_FOOD = 20;

/** One inventory stack. */
export interface ReflexStack {
  item: string;
  count: number;
  book_id?: string | undefined;
}

/** What the reflex reads and changes. */
export interface ReflexState {
  food: number;
  inventory: ReflexStack[];
}

/**
 * The food level at `tick`: starts at `food0`, falls 1 per interval, never below 0.
 * The sim steps food one interval at a time; this closed form is for tests and for tools that need
 * the level at a tick without playing the world.
 */
export function hungerAt(
  tick: number,
  cfg: { hunger_interval_ticks: number },
  food0: number,
): number {
  return Math.max(0, food0 - Math.floor(tick / cfg.hunger_interval_ticks));
}

/**
 * Eats one edible item when `food <= eatBelow`: one item leaves the inventory and food rises by 6
 * (at most 20). Returns a new state; the input is not changed.
 */
export function tryEat(
  state: ReflexState,
  eatBelow: number,
  edible: readonly string[] = ['bread', 'apple', 'cooked_beef'],
): { ate: boolean; item?: string; state: ReflexState } {
  if (state.food > eatBelow) return { ate: false, state };
  const at = state.inventory.findIndex((s) => s.count > 0 && edible.includes(s.item));
  const stack = state.inventory[at];
  if (stack === undefined) return { ate: false, state };
  const inventory = state.inventory.map((s) => ({ ...s }));
  const target = inventory[at];
  if (target === undefined) return { ate: false, state };
  target.count -= 1;
  return {
    ate: true,
    item: stack.item,
    state: {
      food: Math.min(MAX_FOOD, state.food + MEAL_FOOD),
      inventory: inventory.filter((s) => s.count > 0),
    },
  };
}
