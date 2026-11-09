import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from '../actions/bot-types.ts';
import { byCoordinates, distanceToBlock, type Point } from './blocks-summary.ts';
import type { RememberedBlocks } from './remembered.ts';

/** How far the Body looks for notable blocks, in blocks. */
export const NOTABLE_RANGE = 16;
/** Sign text is read only from this close, in blocks. */
export const SIGN_RANGE = 6;
/** The longest sign text reported, in characters (the snapshot cap). */
export const MAX_SIGN_TEXT = 256;
/** The most candidates one `findBlocks` call returns per kind group, so water cannot crowd out a bed. */
export const MAX_CANDIDATES_PER_GROUP = 32;
/** The most notable blocks in one snapshot, nearest first. */
export const MAX_NOTABLE = 64;

/** A notable block as the snapshot reports it. */
export interface NotableBlock {
  type: string;
  x: number;
  y: number;
  z: number;
  text?: string;
}

/** The kinds a snapshot reports (spec 5.2), grouped so each group has its own candidate cap. */
const GROUPS: readonly ((name: string) => boolean)[] = [
  (name) => name.endsWith('_bed'),
  (name) => name === 'chest' || name === 'barrel',
  (name) => name === 'crafting_table' || name === 'furnace',
  (name) => name.endsWith('_log'),
  (name) => /^(deepslate_)?(coal|iron)_ore$/.test(name),
  (name) => name === 'water',
  (name) => name === 'lava',
  isSign,
];

function isSign(name: string): boolean {
  return name.endsWith('_sign') || name.endsWith('_wall_sign') || name.endsWith('_hanging_sign');
}

/** Whether a block name is a kind the snapshot reports. */
export function isNotable(name: string): boolean {
  return GROUPS.some((group) => group(name));
}

/** The shapes the raycast iterator can test a ray against. */
interface RayIterator {
  intersect(shapes: unknown, offset: Vec3): unknown;
}

/** The part of `bot.world` read here: prismarine-world's synchronous raycast. */
interface RaycastWorld {
  raycast(
    from: Vec3,
    direction: Vec3,
    range: number,
    matcher: (block: Block, iter: RayIterator) => boolean,
  ): { position: Vec3 } | null;
}

/** The bot's eyes, where every line of sight starts. */
export function eyePosition(bot: Bot): Vec3 {
  const { position, eyeHeight } = bot.entity as { position: Vec3; eyeHeight?: number };
  return position.offset(0, eyeHeight ?? 1.62, 0);
}

/** Whether the ray from the eyes to the centre of this block reaches the block before any solid shape. */
export function canSeeBlock(bot: Bot, block: Block): boolean {
  const eyes = eyePosition(bot);
  const centre = block.position.offset(0.5, 0.5, 0.5);
  const toBlock = centre.minus(eyes);
  const range = toBlock.norm() + 1;
  if (toBlock.norm() === 0) return true;
  const hit = (bot.world as unknown as RaycastWorld).raycast(
    eyes,
    toBlock.normalize(),
    range,
    (candidate, iter) =>
      iter.intersect(candidate.shapes, candidate.position) !== null ||
      candidate.position.equals(block.position),
  );
  return hit !== null && hit.position.equals(block.position);
}

/** Whether nothing solid lies between the eyes and a point (an entity's body centre). */
export function canSeePoint(bot: Bot, point: Vec3): boolean {
  const eyes = eyePosition(bot);
  const toPoint = point.minus(eyes);
  const range = toPoint.norm();
  if (range === 0) return true;
  const hit = (bot.world as unknown as RaycastWorld).raycast(
    eyes,
    toPoint.normalize(),
    range,
    (candidate, iter) => iter.intersect(candidate.shapes, candidate.position) !== null,
  );
  return hit === null;
}

/** A sign's text, raw, front then back, at most `MAX_SIGN_TEXT` characters; undefined when blank. */
function signText(block: Block): string | undefined {
  const sides = (block as { getSignText?: () => [string, string?] }).getSignText?.() ?? [];
  const text = sides.filter((side): side is string => !!side?.trim()).join('\n');
  return text ? text.slice(0, MAX_SIGN_TEXT) : undefined;
}

/**
 * The notable blocks the agent can see right now, within range and with an unobstructed line from
 * the eyes. Candidates come from `bot.findBlocks`, capped per kind group, so a lake does not hide
 * a chest. Each one is written to `memory`; a remembered block now in view that has changed or
 * gone is replaced or forgotten.
 */
export function observeNotableBlocks(bot: Bot, memory: RememberedBlocks): NotableBlock[] {
  const here = bot.entity.position;
  const seen = new Map<string, NotableBlock>();
  for (const group of GROUPS) {
    const found = bot.findBlocks({
      point: here,
      matching: (block) => group(block.name),
      maxDistance: NOTABLE_RANGE,
      count: MAX_CANDIDATES_PER_GROUP,
    });
    for (const at of found) {
      const block = bot.blockAt(at);
      if (!block || !canSeeBlock(bot, block)) continue;
      const entry: NotableBlock = { type: block.name, x: at.x, y: at.y, z: at.z };
      const text =
        isSign(block.name) && distanceToBlock(here, at) <= SIGN_RANGE ? signText(block) : undefined;
      if (text !== undefined) entry.text = text;
      seen.set(`${at.x},${at.y},${at.z}`, entry);
      memory.remember(entry);
    }
  }
  for (const old of memory.list()) {
    if (seen.has(`${old.x},${old.y},${old.z}`)) continue;
    if (distanceToBlock(here, old) > NOTABLE_RANGE) continue;
    const block = bot.blockAt(new Vec3(old.x, old.y, old.z));
    if (!block || !canSeeBlock(bot, block)) continue;
    // In view and not reported: the block changed or was removed.
    if (isNotable(block.name)) memory.remember({ ...old, type: block.name });
    else memory.forget(old.x, old.y, old.z);
  }
  return [...seen.values()];
}

/**
 * Everything the agent knows of notable blocks: what it sees now (with sign text) plus what it
 * remembers, nearest first and capped at `MAX_NOTABLE`.
 */
export function knownNotableBlocks(bot: Bot, memory: RememberedBlocks): NotableBlock[] {
  const visible = observeNotableBlocks(bot, memory);
  const shown = new Map(visible.map((entry) => [`${entry.x},${entry.y},${entry.z}`, entry]));
  for (const old of memory.list()) {
    const key = `${old.x},${old.y},${old.z}`;
    if (!shown.has(key)) shown.set(key, { ...old });
  }
  const here = bot.entity.position as Point;
  return [...shown.values()]
    .sort(
      (a, b) =>
        distanceToBlock(here, a) - distanceToBlock(here, b) ||
        (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) ||
        byCoordinates(a, b),
    )
    .slice(0, MAX_NOTABLE);
}
