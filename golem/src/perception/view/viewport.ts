import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { eyePosition } from '../notable-blocks.ts';

/**
 * The text viewport (view-tool packet): rays cast across the field of view the body faces. Each ray
 * reports only what line of sight reveals: it stops at the first opaque block, reports transparent
 * blocks and mobs on the way, and never looks into a chunk that is not loaded (decision 0154).
 */

export const DEFAULT_COLS = 21;
export const DEFAULT_ROWS = 9;
/** The horizontal and vertical field of view, in radians (about 90 and 45 degrees). */
const H_FOV = (90 * Math.PI) / 180;
const V_FOV = (45 * Math.PI) / 180;
/** How far a ray looks, in blocks. */
export const MAX_RANGE = 24;
/** In the dark (light under DARK_LIGHT at the eyes) a ray stops at DARK_RANGE: nothing beyond is made out. */
export const DARK_RANGE = 6;
export const DARK_LIGHT = 4;
/** A solid block within this many blocks counts as near when the view is read for enclosure. */
export const NEAR_SOLID = 2;
const STEP = 0.25;

export type SampleKind = 'unknown' | 'air' | 'solid' | 'water' | 'leaves' | 'glass';

/** One block as the ray sees it. `unknown` is a block in a chunk that is not loaded. */
export interface Sample {
  kind: SampleKind;
  name?: string;
}

export interface ViewMob {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface ViewWorld {
  block(x: number, y: number, z: number): Sample;
  mobs: readonly ViewMob[];
  /** True when the light at the eyes is under DARK_LIGHT. */
  dark: boolean;
}

/** The eye position and look direction, in mineflayer's convention: yaw 0 is north, pi/2 west; pitch positive is up. */
export interface ViewPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export type RayKind = 'air' | 'solid' | 'water' | 'leaves' | 'glass' | 'mob' | 'unknown' | 'dark';

/** What one ray reports: its first hit (`air` when it reaches its range with nothing), and the first opaque block if any. */
export interface Ray {
  kind: RayKind;
  name?: string;
  distance?: number;
  solidDistance?: number;
}

/** The grid: `rays[row][col]`, row 0 at the top and column 0 at the left. */
export interface ViewGrid {
  cols: number;
  rows: number;
  yaw: number;
  pitch: number;
  rays: Ray[][];
}

/** The unit vector a yaw and pitch look along (mineflayer's convention). */
export function lookVector(yaw: number, pitch: number): [number, number, number] {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** The yaw and pitch of one ray. Columns run left to right (a positive offset is right); rows run top to bottom. */
export function rayAngles(
  pose: ViewPose,
  cols: number,
  rows: number,
  col: number,
  row: number,
): [number, number] {
  const right = ((col + 0.5) / cols - 0.5) * H_FOV;
  const up = (0.5 - (row + 0.5) / rows) * V_FOV;
  return [pose.yaw - right, pose.pitch + up];
}

function insideMob(mob: ViewMob, x: number, y: number, z: number): boolean {
  const half = mob.width / 2;
  return (
    Math.abs(x - mob.x) <= half &&
    Math.abs(z - mob.z) <= half &&
    y >= mob.y &&
    y <= mob.y + mob.height
  );
}

/** Marches one ray from the eyes. Transparent blocks and mobs are recorded; the first opaque block ends the ray. */
function castRay(world: ViewWorld, pose: ViewPose, yaw: number, pitch: number): Ray {
  const [dx, dy, dz] = lookVector(yaw, pitch);
  const limit = world.dark ? DARK_RANGE : MAX_RANGE;
  let first: Ray | undefined;
  let solidDistance: number | undefined;
  let lastKey = '';
  for (let t = STEP; t <= limit; t += STEP) {
    const x = pose.x + dx * t;
    const y = pose.y + dy * t;
    const z = pose.z + dz * t;
    const mob = world.mobs.find((m) => insideMob(m, x, y, z));
    if (mob !== undefined && first === undefined) {
      first = { kind: 'mob', name: mob.name, distance: t };
    }
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const key = `${bx},${by},${bz}`;
    if (key === lastKey) continue;
    lastKey = key;
    const sample = world.block(bx, by, bz);
    if (sample.kind === 'unknown') {
      first ??= { kind: 'unknown', distance: t };
      break;
    }
    if (sample.kind === 'air') continue;
    first ??= {
      kind: sample.kind,
      distance: t,
      ...(sample.name === undefined ? {} : { name: sample.name }),
    };
    if (sample.kind === 'solid') {
      solidDistance = t;
      break;
    }
  }
  if (first === undefined)
    return world.dark ? { kind: 'dark', distance: limit } : { kind: 'air', distance: limit };
  if (solidDistance !== undefined) first.solidDistance = solidDistance;
  return first;
}

/** Casts the whole grid from a pose. Pure: the world is passed in, so the same code runs on a fake world in tests. */
export function castViewport(
  world: ViewWorld,
  pose: ViewPose,
  cols: number = DEFAULT_COLS,
  rows: number = DEFAULT_ROWS,
): ViewGrid {
  const grid: Ray[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: Ray[] = [];
    for (let col = 0; col < cols; col++) {
      const [yaw, pitch] = rayAngles(pose, cols, rows, col, row);
      line.push(castRay(world, pose, yaw, pitch));
    }
    grid.push(line);
  }
  return { cols, rows, yaw: pose.yaw, pitch: pose.pitch, rays: grid };
}

/** Sorts a block by name: air, water-like (water, lava), leaves, glass, or solid (anything else with a shape). */
export function classifyBlock(name: string, boundingBox: string): Sample {
  if (name === 'air' || name === 'cave_air' || name === 'void_air') return { kind: 'air' };
  if (name === 'water' || name === 'lava' || name === 'bubble_column')
    return { kind: 'water', name };
  if (name.endsWith('_leaves')) return { kind: 'leaves', name };
  if (name === 'glass' || name.endsWith('_glass') || name.endsWith('_glass_pane'))
    return { kind: 'glass', name };
  if (boundingBox === 'empty') return { kind: 'air' };
  return { kind: 'solid', name };
}

interface BotBlock {
  name: string;
  boundingBox?: string;
  light?: number;
  skyLight?: number;
}

interface BotEntity {
  type?: string;
  name?: string;
  position: Vec3;
  width?: number;
  height?: number;
}

const SEEN_TYPES: ReadonlySet<string> = new Set(['mob', 'hostile', 'passive', 'animal', 'player']);

/** The live world and pose of a bot, read through mineflayer. A chunk that is not loaded reads as `unknown`. */
export function viewFromBot(bot: Bot): { world: ViewWorld; pose: ViewPose } {
  const eyes = eyePosition(bot);
  const self = bot.entity as unknown as { yaw: number; pitch: number };
  const blockAt = (x: number, y: number, z: number): BotBlock | null =>
    (bot.world.getBlock(new Vec3(x, y, z)) as unknown as BotBlock | null) ?? null;
  const eyeBlock = blockAt(Math.floor(eyes.x), Math.floor(eyes.y), Math.floor(eyes.z));
  const light = Math.max(eyeBlock?.light ?? 15, eyeBlock?.skyLight ?? 15);
  const mobs: ViewMob[] = [];
  for (const entity of Object.values(bot.entities) as unknown as BotEntity[]) {
    if (entity.position === undefined || entity.type === undefined || !SEEN_TYPES.has(entity.type))
      continue;
    if (entity.position.distanceTo(eyes) > MAX_RANGE) continue;
    if (entity.position.equals(bot.entity.position)) continue;
    mobs.push({
      name: entity.type === 'player' ? 'player' : (entity.name ?? entity.type),
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
      width: entity.width ?? 0.6,
      height: entity.height ?? 1.8,
    });
  }
  const world: ViewWorld = {
    dark: light < DARK_LIGHT,
    mobs,
    block(x, y, z) {
      const block = blockAt(x, y, z);
      if (block === null) return { kind: 'unknown' };
      return classifyBlock(block.name, block.boundingBox ?? 'block');
    },
  };
  const pose: ViewPose = { x: eyes.x, y: eyes.y, z: eyes.z, yaw: self.yaw, pitch: self.pitch };
  return { world, pose };
}
