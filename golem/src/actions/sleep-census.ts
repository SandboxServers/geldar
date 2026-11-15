import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';

/** The horizontal neighbors searched for the other half of a bed. */
export const HORIZONTAL = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

/** The most bed block positions one census search asks for: more than a real search range holds. */
const CENSUS_COUNT = 512;

/** The beds within range and how many of them the world holds occupied, read at one moment (decision 0226). */
export interface BedCensus {
  /** The beds within range. A bed is two blocks and counts once. */
  in_range: number;
  /** The beds with a half whose `occupied` state is true. */
  occupied: number;
  /** The beds no half of which reports an `occupied` state. They are not counted as occupied. */
  unknown: number;
}

/** A bed as the census groups it: its first block found, and every block of it found. */
interface CensusBed {
  first: Block;
  halves: Block[];
}

/**
 * The beds within `range` blocks of the bot, read from the world now. Blocks are grouped as the bed loop groups
 * them: a block next to a bed's first block is that bed's other half. A bed is occupied when a half says so.
 */
export function takeCensus(bot: Bot, range: number): BedCensus {
  const from = bot.entity.position;
  const positions = bot.findBlocks({
    matching: (block: Block) => block.name.endsWith('_bed'),
    maxDistance: range,
    count: CENSUS_COUNT,
  });
  const beds = groupBeds(bot, positions, from);
  let occupied = 0;
  let unknown = 0;
  for (const { halves } of beds) {
    const states = halves.map(occupiedState);
    if (states.includes(true)) occupied += 1;
    else if (states.every((state) => state === undefined)) unknown += 1;
  }
  return { in_range: beds.length, occupied, unknown };
}

/** The census as the failure text states it: `B beds within R blocks, O occupied`, with `bed` for one bed. */
export function censusText(census: BedCensus, range: number): string {
  const noun = census.in_range === 1 ? 'bed' : 'beds';
  return `${census.in_range} ${noun} within ${range} blocks, ${census.occupied} occupied`;
}

/** The beds among the bed block positions, nearest block first. */
function groupBeds(bot: Bot, positions: readonly Vec3[], from: Vec3): CensusBed[] {
  const beds: CensusBed[] = [];
  const sorted = [...positions].sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
  for (const position of sorted) {
    const block = bot.blockAt(position);
    if (!block) continue;
    const bed = beds.find((known) => isOtherHalf(known.first, block));
    if (bed) bed.halves.push(block);
    else beds.push({ first: block, halves: [block] });
  }
  return beds;
}

/** True when `block` is the other half of the bed whose first block is `first`: the same name, next to it. */
function isOtherHalf(first: Block, block: Block): boolean {
  return (
    first.name === block.name &&
    HORIZONTAL.some((offset) => first.position.plus(offset).equals(block.position))
  );
}

/** The `occupied` state of a bed half, or undefined when the half's state cannot be read. */
function occupiedState(block: Block): boolean | undefined {
  try {
    const properties = (
      block as { getProperties?: () => Record<string, unknown> }
    ).getProperties?.();
    const occupied = properties?.occupied;
    return typeof occupied === 'boolean' ? occupied : undefined;
  } catch {
    return undefined;
  }
}
