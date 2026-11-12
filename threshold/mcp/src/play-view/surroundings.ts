import type { Snapshot } from '@geldar/contract';
import { hazardsPart } from './hazards.ts';
import { PLAY_ENTITY_LIMIT, type SnapshotProjector } from './types.ts';

/**
 * The blocks and beings around the agent. Notable blocks keep their position and kind but not their
 * text: sign text goes to `untrusted_world_text` (see `untrusted.ts`).
 */
export const surroundingsProjector: SnapshotProjector = (snapshot) => {
  const notableBlocks: Snapshot['surroundings']['notable_blocks'] =
    snapshot.surroundings.notable_blocks.map(({ text: _text, ...block }) => block);
  return {
    surroundings: {
      blocks_summary: snapshot.surroundings.blocks_summary,
      ...(snapshot.surroundings.standing_on === undefined
        ? {}
        : { standing_on: snapshot.surroundings.standing_on }),
      ...(snapshot.surroundings.block_above_feet === undefined
        ? {}
        : { block_above_feet: snapshot.surroundings.block_above_feet }),
      ...(snapshot.surroundings.enclosed === undefined
        ? {}
        : { enclosed: snapshot.surroundings.enclosed }),
      notable_blocks: notableBlocks,
      entities: snapshot.surroundings.entities?.slice(0, PLAY_ENTITY_LIMIT),
      agents: snapshot.surroundings.agents,
      ...hazardsPart(snapshot.surroundings),
    },
  };
};
