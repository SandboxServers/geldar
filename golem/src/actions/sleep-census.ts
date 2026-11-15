import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';

/** The most bed block positions one census search asks for: more than a real search range holds. */
const CENSUS_COUNT = 512;

/**
 * The unit vector of each bed `facing`. A foot's position plus its vector is its head's position, so a head
 * is the foot's position minus the vector.
 */
const FACING = new Map<string, Vec3>([
  ['north', new Vec3(0, 0, -1)],
  ['south', new Vec3(0, 0, 1)],
  ['west', new Vec3(-1, 0, 0)],
  ['east', new Vec3(1, 0, 0)],
]);

/** The beds within range and how many of them the world holds occupied, read at one moment (decision 0226). */
export interface BedCensus {
  /** The beds within range. A bed is two blocks and counts once. */
  in_range: number;
  /** The beds with a half whose `occupied` state is true. */
  occupied: number;
  /** The beds no half of which reports an `occupied` state. They are not counted as occupied. */
  unknown: number;
}

/** A bed block's part and facing, as its block state reports them. */
interface BedShape {
  part: 'head' | 'foot';
  facing: Vec3;
}

/**
 * The beds within `range` blocks of the bot, read from the world now. Blocks are grouped by `bedKey`: the two
 * halves of a bed share a key, and a neighbouring bed does not. A bed is occupied when a half says so.
 */
export function takeCensus(bot: Bot, range: number): BedCensus {
  const positions = bot.findBlocks({
    matching: (block: Block) => block.name.endsWith('_bed'),
    maxDistance: range,
    count: CENSUS_COUNT,
  });
  const beds = groupBeds(bot, positions);
  let occupied = 0;
  let unknown = 0;
  for (const halves of beds.values()) {
    const states = halves.map(occupiedState);
    if (states.includes(true)) occupied += 1;
    else if (states.every((state) => state === undefined)) unknown += 1;
  }
  return { in_range: beds.size, occupied, unknown };
}

/** The census as the failure text states it: `B beds within R blocks, O occupied`, with `bed` for one bed. */
export function censusText(census: BedCensus, range: number): string {
  const noun = census.in_range === 1 ? 'bed' : 'beds';
  return `${census.in_range} ${noun} within ${range} blocks, ${census.occupied} occupied`;
}

/**
 * The key of the bed a block belongs to: its name and the position of its head. A head keys itself; a foot keys
 * its position plus its facing vector. The name is part of the key, so two colours never make one bed. A block
 * whose part or facing cannot be read keys only itself, so no other block shares its key (decision 0226).
 * The census and the bed loop both group by this key.
 */
export function bedKey(block: Block): string {
  const shape = bedShape(block);
  if (shape === undefined) return `self ${block.name} ${coords(block.position)}`;
  const head = shape.part === 'head' ? block.position : block.position.plus(shape.facing);
  return `${block.name} ${coords(head)}`;
}

/**
 * The position of the other half of a bed block, from its part and facing: a head's foot is its position minus
 * the facing vector, a foot's head is its position plus it. Undefined when the part or facing cannot be read.
 */
export function otherHalfPosition(block: Block): Vec3 | undefined {
  const shape = bedShape(block);
  if (shape === undefined) return undefined;
  return shape.part === 'head'
    ? block.position.minus(shape.facing)
    : block.position.plus(shape.facing);
}

/** The blocks of each bed found, keyed by `bedKey`. */
function groupBeds(bot: Bot, positions: readonly Vec3[]): Map<string, Block[]> {
  const beds = new Map<string, Block[]>();
  for (const position of positions) {
    const block = bot.blockAt(position);
    if (!block) continue;
    const key = bedKey(block);
    const halves = beds.get(key);
    if (halves) halves.push(block);
    else beds.set(key, [block]);
  }
  return beds;
}

/** The part and facing of a bed block, or undefined when either cannot be read. */
function bedShape(block: Block): BedShape | undefined {
  const properties = blockProperties(block);
  const { part, facing } = properties ?? {};
  const vector = typeof facing === 'string' ? FACING.get(facing) : undefined;
  if ((part !== 'head' && part !== 'foot') || vector === undefined) return undefined;
  return { part, facing: vector };
}

/** The `occupied` state of a bed half, or undefined when the half's state cannot be read. */
function occupiedState(block: Block): boolean | undefined {
  const occupied = blockProperties(block)?.occupied;
  return typeof occupied === 'boolean' ? occupied : undefined;
}

/** The block's properties as Mineflayer reports them, or undefined when they cannot be read. */
function blockProperties(block: Block): Record<string, unknown> | undefined {
  try {
    return (block as { getProperties?: () => Record<string, unknown> }).getProperties?.();
  } catch {
    return undefined;
  }
}

/** A position as `x y z`. */
function coords(position: Vec3): string {
  return `${position.x} ${position.y} ${position.z}`;
}
