/** The part of the Mineflayer registry read here: minecraft-data's food table, keyed by item name. */
export interface FoodRegistry {
  foodsByName?: Record<string, unknown>;
}

/**
 * Whether a held item is food the game lets the agent eat. The answer is minecraft-data's own food
 * table: bread, potato and beef are food; wheat and seeds are not. An item the table does not list,
 * or an inherited property name such as `constructor`, is not food.
 */
export function isEdibleItem(registry: FoodRegistry, name: string): boolean {
  return Object.hasOwn(registry.foodsByName ?? {}, name);
}
