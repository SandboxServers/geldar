// A mocked feed for tests and the dev page: a flat stone floor with a grass top and one agent.

import type { KinoFeed } from '../../../contract/src/generated/types.ts';
import { cellIndex, encodePaletteIndices } from './palette.ts';

export function floorSection(chunkX: number, chunkZ: number): KinoFeed {
  const idx = new Uint16Array(4096);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) idx[cellIndex(x, 0, z)] = 1;
  return {
    type: 'chunk_section',
    chunk_x: chunkX,
    chunk_z: chunkZ,
    section_y: 0,
    palette: ['minecraft:air', 'minecraft:grass_block[snowy=false]'],
    bits: 1,
    data: encodePaletteIndices(idx, 1),
  };
}

export function devFeed(): KinoFeed[] {
  return [
    { type: 'hello', feed_version: 1, world: 'world', target_agent_id: 'agent_a', view_radius: 2 },
    floorSection(0, 0),
    floorSection(1, 0),
    { type: 'block_update', pos: { x: 3, y: 1, z: 3 }, state: 'minecraft:oak_log[axis=y]' },
    {
      type: 'entity_positions',
      entities: [
        {
          id: 'e1',
          type: 'minecraft:player',
          agent_id: 'agent_a',
          x: 4.5,
          y: 1,
          z: 4.5,
          yaw: 90,
          pitch: 0,
        },
        { id: 'e2', type: 'minecraft:zombie', x: 8.5, y: 1, z: 8.5, yaw: 0, pitch: 0 },
      ],
    },
    { type: 'target_moved', target_agent_id: 'agent_a', x: 4.5, y: 1, z: 4.5 },
  ];
}
