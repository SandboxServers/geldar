import { Vec3 } from 'vec3';

/**
 * The block state a placement asks for. Program-only (decision 0349, the pattern of `mineAt`): it
 * is not an agent field of the `place` action.
 */
export interface PlaceState {
  axis?: 'x' | 'y' | 'z';
  facing?: Cardinal;
  half?: 'top' | 'bottom';
}

export type Cardinal = 'north' | 'south' | 'east' | 'west';

/** The click that achieves a state: the reference cell as an offset from the target, and the look. */
export interface ClickPlan {
  reference: Vec3;
  yaw: number;
  pitch: number;
  cursorY: number;
}

/** The code a state that no click can reach gets; the block is not placed. */
export const STATE_UNACHIEVABLE = 'state_unachievable';

/** Tier 1: logs and pillars take an axis. */
const AXIS_BLOCK = /_(log|wood)$|^(hay_block|bone_block)$|_pillar$/;
/** Tier 1: stairs take a facing (and a half, tier 2). */
const STAIRS = /_stairs$/;
/** Tier 1: doors, furnaces and chests take a facing. */
const FACING_BLOCK = /_door$|^(furnace|chest|trapped_chest|ender_chest)$/;
/** Tier 2: slabs take a half, stored as `type`. */
const SLAB = /_slab$/;

/** The look direction that each cardinal name stands for (mineflayer: yaw 0 looks at -z). */
const LOOK_VECTOR: Record<Cardinal, Vec3> = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
};

/** The keys of `PlaceState` a block takes; an empty list for a block with no state we place. */
export function allowedKeys(block: string): (keyof PlaceState)[] {
  if (AXIS_BLOCK.test(block)) return ['axis'];
  if (STAIRS.test(block)) return ['facing', 'half'];
  if (FACING_BLOCK.test(block)) return ['facing'];
  if (SLAB.test(block)) return ['half'];
  return [];
}

/** The block-state property name a key is stored under: slabs keep their half as `type`. */
function propertyOf(block: string, key: keyof PlaceState): string {
  return key === 'half' && SLAB.test(block) ? 'type' : key;
}

/**
 * The cardinal a yaw looks toward. mineflayer's look vector is (-sin yaw, sin pitch, -cos yaw), so
 * yaw 0 looks at -z (north) and yaw pi/2 at -x (west), the same convention as `stepsFromFacing`.
 */
export function cardinalOfYaw(yaw: number): Cardinal {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  return dz > 0 ? 'south' : 'north';
}

/**
 * The yaw that looks along `facing`, which is the facing a placed stair, chest or door takes from
 * the bot's look (`clickedProperties`). Inverse of mineflayer's look vector: yaw = atan2(-dx, -dz).
 */
export function yawForFacing(facing: Cardinal): number {
  return yawToward(LOOK_VECTOR[facing]);
}

/** The yaw that looks along a horizontal direction (the inverse of mineflayer's look vector). */
export function yawToward(direction: Vec3): number {
  return Math.atan2(-direction.x, -direction.z);
}

/** The pitch that looks at a reference: up for a cell above, down for one below, level beside. */
export function pitchFor(reference: Vec3): number {
  if (reference.y > 0) return -Math.PI / 2;
  if (reference.y < 0) return Math.PI / 2;
  return 0;
}

/**
 * The click rule the planner models: the clicked face fixes the axis (and, for a slab or stair,
 * the half: a top face gives a bottom half, a bottom face a top half, a side face the cursor's
 * height); the bot's look fixes the facing (the placed block faces the way the bot looks).
 */
export function clickedProperties(
  block: string,
  reference: Vec3,
  yaw: number,
  cursorY: number,
): Record<string, string> {
  const face = new Vec3(-reference.x, -reference.y, -reference.z);
  const properties: Record<string, string> = {};
  for (const key of allowedKeys(block)) {
    if (key === 'axis') {
      properties[propertyOf(block, key)] = face.x !== 0 ? 'x' : face.y !== 0 ? 'y' : 'z';
    } else if (key === 'facing') {
      properties[propertyOf(block, key)] = cardinalOfYaw(yaw);
    } else {
      const top = face.y !== 0 ? face.y < 0 : cursorY > 0.5;
      properties[propertyOf(block, key)] = top ? 'top' : 'bottom';
    }
  }
  return properties;
}

/** True when the block's properties hold every key the state asks for. */
export function stateMatches(
  block: string,
  want: PlaceState,
  properties: Record<string, string>,
): boolean {
  return (Object.keys(want) as (keyof PlaceState)[]).every(
    (key) => properties[propertyOf(block, key)] === want[key],
  );
}

/**
 * The click that places the state, tried against each reference in order; null when the block
 * takes no such property or no reference gives the state (`STATE_UNACHIEVABLE`).
 */
export function planPlaceState(
  block: string,
  want: PlaceState,
  references: readonly Vec3[],
): ClickPlan | null {
  return planAt(block, want, references);
}

/**
 * `planPlaceState` for a placement that sends the centre cursor (height 0.5): a click on a side
 * face whose plan needs another cursor height is not sent, so the next reference is tried. Null
 * when no reference gives the state with the click that is sent.
 */
export function planSentClick(
  block: string,
  want: PlaceState,
  references: readonly Vec3[],
): ClickPlan | null {
  let open = references;
  while (open.length > 0) {
    const plan = planAt(block, want, open);
    if (plan === null) return null;
    if (plan.cursorY === 0.5 || plan.reference.y !== 0) return plan;
    open = open.filter((reference) => !reference.equals(plan.reference));
  }
  return null;
}

function planAt(block: string, want: PlaceState, references: readonly Vec3[]): ClickPlan | null {
  const takes = allowedKeys(block);
  if ((Object.keys(want) as (keyof PlaceState)[]).some((key) => !takes.includes(key))) {
    return null;
  }
  const yaw = want.facing !== undefined ? yawForFacing(want.facing) : 0;
  const cursorY = want.half === 'top' ? 0.75 : want.half === 'bottom' ? 0.25 : 0.5;
  for (const reference of references) {
    const properties = clickedProperties(block, reference, yaw, cursorY);
    if (stateMatches(block, want, properties)) {
      return { reference, yaw, pitch: pitchFor(reference), cursorY };
    }
  }
  return null;
}
