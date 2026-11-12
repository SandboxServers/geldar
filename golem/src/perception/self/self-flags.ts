import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ownAir } from '../../body/air.ts';

type StatusFlag = NonNullable<Snapshot['self']['status_flags']>[number];

/** The eye height of a standing player, in blocks. */
const EYE_HEIGHT = 1.62;
/** Air below this is shown; a full breath omits the key. */
const FULL_AIR = 20;

/** Armour points per piece (helmet, chestplate, leggings, boots) by material. Game values. */
const MATERIAL_POINTS: Record<string, readonly [number, number, number, number]> = {
  leather: [1, 3, 2, 1],
  chainmail: [2, 5, 4, 1],
  iron: [2, 6, 5, 2],
  golden: [2, 5, 3, 1],
  diamond: [3, 8, 6, 3],
  netherite: [3, 8, 6, 3],
};
const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;

/** Armour points of one item name, or 0 when it is not armour. */
function piecePoints(name: string): number {
  if (name === 'turtle_helmet') return 2;
  for (const [material, points] of Object.entries(MATERIAL_POINTS)) {
    if (!name.startsWith(`${material}_`)) continue;
    const piece = PIECES.indexOf(name.slice(material.length + 1) as (typeof PIECES)[number]);
    if (piece >= 0) return points[piece] ?? 0;
  }
  return 0;
}

/** The armour total from the four equipped slots: 5 helmet, 6 chestplate, 7 leggings, 8 boots. */
function armour(bot: Bot): number {
  const slots = bot.inventory?.slots ?? [];
  let total = 0;
  for (const index of [5, 6, 7, 8]) {
    const name = slots[index]?.name;
    if (name !== undefined) total += piecePoints(name);
  }
  return Math.min(total, 20);
}

/** Entity flags metadata bit 0 is on fire (the Body's `onFire` reads the same bit). */
function burning(bot: Bot): boolean {
  const flags: unknown = bot.entity?.metadata?.[0];
  return typeof flags === 'number' && (flags & 1) === 1;
}

/** The physics plugin's in-water flag on the entity (the typings omit it). */
function inWater(bot: Bot): boolean {
  return (bot.entity as unknown as Record<string, unknown>)?.isInWater === true;
}

/** True when the eye block is water: the block the player's head is in, not the feet. */
function underwater(bot: Bot): boolean {
  const feet = bot.entity?.position;
  if (!feet) return false;
  return bot.blockAt(new Vec3(feet.x, feet.y + EYE_HEIGHT, feet.z))?.name === 'water';
}

/** The true flags only, in the schema's fixed order. */
function statusFlags(bot: Bot): StatusFlag[] {
  const entity = bot.entity;
  if (!entity) return [];
  const flags: StatusFlag[] = [];
  if (burning(bot)) flags.push('burning');
  if (underwater(bot)) flags.push('underwater');
  if (!entity.onGround && (entity.velocity?.y ?? 0) < 0) flags.push('falling');
  if (inWater(bot)) flags.push('in_water');
  if (entity.onGround) flags.push('on_ground');
  return flags;
}

/** Breath bubbles, shown only below a full breath. */
function air(bot: Bot): number | undefined {
  const level = ownAir(bot);
  if (level >= FULL_AIR) return undefined;
  return level;
}

/** Armour, status flags and air. Each key is omitted when it has nothing to say. */
export function selfFlags(bot: Bot): Partial<Snapshot['self']> {
  const out: Partial<Snapshot['self']> = { armor: armour(bot) };
  const flags = statusFlags(bot);
  // The generated type is a non-empty tuple (the schema has minItems 1); the key is only set when non-empty.
  if (flags.length > 0) out.status_flags = flags as [StatusFlag, ...StatusFlag[]];
  const breath = air(bot);
  if (breath !== undefined) out.air = breath;
  return out;
}
