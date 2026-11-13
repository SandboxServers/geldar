import { createRequire } from 'node:module';
import type { Vec3 } from 'vec3';

/**
 * Real 26.1 blocks for the door tests. Golem does not declare prismarine-block or prismarine-registry,
 * so they are loaded from mineflayer's own dependencies, the copies the live body runs on.
 */
const fromMineflayer = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
export const registry = fromMineflayer('prismarine-registry')('26.1');
const Block = fromMineflayer('prismarine-block')(registry);

/** The subset of a prismarine block the door rules read. */
export interface RealBlock {
  name: string;
  boundingBox: string;
  position?: Vec3;
  getProperties(): Record<string, unknown>;
}

/** Oak door states from the live server (rcon, `data get` on 26.1): the open lower and upper halves. */
export const OAK_DOOR_OPEN_LOWER = 5716;
export const OAK_DOOR_OPEN_UPPER = 5708;

/** A real block at a state id. */
export function realBlock(stateId: number): RealBlock {
  return Block.fromStateId(stateId, 0) as RealBlock;
}

/** The default state of a named block (an iron door's default is its lower half, closed). */
export function defaultBlock(name: string): RealBlock {
  return Block.fromStateId(registry.blocksByName[name].defaultState, 0) as RealBlock;
}

/** The world key of a cell, as the fakes index blocks by it. */
export const cellKey = (v: { x: number; y: number; z: number }): string =>
  `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;
