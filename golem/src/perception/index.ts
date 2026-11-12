import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Perception } from '../mind-link/senses.ts';
import { summarizeBlocks } from './blocks-summary.ts';
import { observeEntities } from './entities.ts';
import { footing } from './footing.ts';
import { summaryWithCounts } from './nearby-counts.ts';
import { knownNotableBlocks } from './notable-blocks.ts';
import { unlockedRecipes } from './recipes.ts';
import { RememberedBlocks } from './remembered.ts';
import { surroundingsProbes } from './surroundings/index.ts';

export { compass, summarizeBlocks } from './blocks-summary.ts';
export { RememberedBlocks } from './remembered.ts';

/**
 * The Body's perception of the world (spec 5.2): the surroundings the agent is allowed to know,
 * built from what its eyes reach, and the recipes it has unlocked. Each `surroundings()` call
 * looks again and updates what is remembered; nothing the Body has not seen is reported.
 */
export function createPerception(bot: Bot): Perception {
  const memory = new RememberedBlocks();
  return {
    surroundings(): Snapshot['surroundings'] {
      if (!bot.entity) return { blocks_summary: '', notable_blocks: [], entities: [], agents: [] };
      const notable = knownNotableBlocks(bot, memory);
      return {
        blocks_summary: summaryWithCounts(summarizeBlocks(bot.entity.position, notable), bot),
        notable_blocks: notable,
        ...footing(bot),
        ...observeEntities(bot),
        ...surroundingsProbes(bot),
      };
    },
    unlockedRecipes: () => unlockedRecipes(bot),
  };
}
