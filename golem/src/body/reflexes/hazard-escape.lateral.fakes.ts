import type { Vec3 } from 'vec3';
import { controlBot } from './hazard-escape.fakes.ts';

export type Block = { name: string; boundingBox: string };
export const STONE: Block = { name: 'stone', boundingBox: 'block' };
export const WATER: Block = { name: 'water', boundingBox: 'empty' };
export const AIR: Block = { name: 'air', boundingBox: 'empty' };

/** Stone everywhere except the listed cells, keyed "x,y,z". */
export function worldOf(cells: Record<string, Block>): (v: Vec3) => Block {
  return (v) => cells[`${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`] ?? STONE;
}

/** A 1-wide water column at x 0, z 0 (y 58..61) under a stone cap at y 62. A water corridor at y 60..61 runs east to an open shaft at x 6. */
export function cappedWorld(): Record<string, Block> {
  const cells: Record<string, Block> = {};
  for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
  for (let x = 1; x <= 5; x++) for (const y of [60, 61]) cells[`${x},${y},0`] = WATER;
  for (let y = 60; y <= 63; y++) cells[`6,${y},0`] = AIR;
  return cells;
}

/** A swimmer in a fixed world: held forward moves it `speed` along `dir`, else held jump lifts it by `rise`. */
export function swimmerIn(
  world: (v: Vec3) => Block,
  at: Vec3,
  rise: number,
  dir = { dx: 1, dz: 0 },
  speed = 0.2,
) {
  const { bot, controls, state } = controlBot(at);
  const held = new Set<string>();
  const b = bot as unknown as {
    setControlState: (name: string, on: boolean) => void;
    blockAt: (v: Vec3) => Block;
    waitForTicks: () => Promise<void>;
    entity: { position: Vec3 };
  };
  b.setControlState = (name, on) => {
    controls.push(`${name}:${on}`);
    if (on) held.add(name);
    else held.delete(name);
  };
  b.blockAt = (v) => world(v);
  b.waitForTicks = async () => {
    state.ticks += 1;
    const p = b.entity.position;
    if (held.has('forward')) b.entity.position = p.offset(dir.dx * speed, 0, dir.dz * speed);
    else if (held.has('jump')) b.entity.position = p.offset(0, rise, 0);
  };
  return {
    bot: bot as never,
    controls,
    state,
    pos: (): Vec3 => b.entity.position,
    isForward: (): boolean => held.has('forward'),
  };
}

export const EAST = { name: 'east', dx: 1, dz: 0 };
export const SOUTH = { name: 'south', dx: 0, dz: 1 };
export const WEST = { name: 'west', dx: -1, dz: 0 };
export const NORTH = { name: 'north', dx: 0, dz: -1 };
export const SIDES = [EAST, SOUTH, WEST, NORTH];

/** The whole block cell the Body is in, counted along a side from the open column at the origin. */
export function cellAlong(pos: Vec3, side: { dx: number; dz: number }): number {
  return Math.floor(pos.x) * side.dx + Math.floor(pos.z) * side.dz;
}

/**
 * The origin column (water y 58..61) under a stone cap at y 62, a water corridor at y 60..61 out to
 * `distance` along `side`, and the exit there: a lake surface (water to y 61, air above) or a dry shaft.
 */
export function capped(side: { dx: number; dz: number }, distance: number, exit: 'lake' | 'shaft') {
  const cells: Record<string, Block> = {};
  for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
  for (let k = 1; k < distance; k++) {
    for (const y of [60, 61]) cells[`${k * side.dx},${y},${k * side.dz}`] = WATER;
  }
  const ex = distance * side.dx;
  const ez = distance * side.dz;
  for (const y of [60, 61]) {
    cells[`${ex},${y},${ez}`] = exit === 'lake' ? WATER : AIR;
  }
  for (const y of [62, 63]) cells[`${ex},${y},${ez}`] = AIR;
  return cells;
}
