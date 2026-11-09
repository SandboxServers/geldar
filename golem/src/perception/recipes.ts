import type { Bot } from 'mineflayer';
import { unlockedResultItems } from '../actions/craft-table.ts';

/** The most recipes one snapshot lists (the snapshot cap). */
export const MAX_UNLOCKED_RECIPES = 1500;

/**
 * The item names the agent can craft because it unlocked their recipes (decision 0048): sorted,
 * unique, at most `MAX_UNLOCKED_RECIPES`. Empty until the server has sent the recipe book.
 */
export function unlockedRecipes(bot: Bot): string[] {
  return unlockedResultItems(bot).slice(0, MAX_UNLOCKED_RECIPES);
}
