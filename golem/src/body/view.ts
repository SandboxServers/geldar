import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isNightOrStorm } from '../actions/sleep.ts';
import { worldAge } from '../world-clock.ts';
import { type SafeSpot, trackSafeSpot } from './safe-spot.ts';

/** A hostile mob near the Body. */
export interface HostileView {
  /** Mineflayer's mob name, for example `zombie`. */
  name: string;
  /** Straight-line distance from the Body in blocks. */
  distance: number;
  position: { x: number; y: number; z: number };
  /**
   * True when the mob is within melee reach and faces the Body, so it is the one hitting it.
   * Optional so a hand-built view may leave it out; a reflex reads a missing value as true.
   */
  attacking?: boolean;
}

/**
 * What a reflex may see of the Body: plain data, no bot, no way to act. Like `limitedControl`
 * for the bench, it narrows the bot to reads. Every value is read at call time, so one view
 * stays current across ticks.
 */
export interface BodyView {
  /** World age in ticks, or null before the first time packet. */
  readonly tick: number | null;
  /** 0 to 20 (Health Boost can lift the raw value above 20). */
  readonly health: number;
  /** Food level, 0 to 20. */
  readonly hunger: number;
  /** Feet position in block coordinates. */
  readonly position: { x: number; y: number; z: number };
  /** Hostile mobs within `radius` blocks (default 16), nearest first. */
  nearbyHostiles(radius?: number): HostileView[];
  /** How many of the named item the Body carries (`bread`), summed over stacks. */
  inventoryCount(item: string): number;
  /** The fluid the Body's feet are in, or null. */
  readonly inFluid: 'water' | 'lava' | null;
  /** True while the Body is on fire. */
  readonly onFire: boolean;
  /** Blocks fallen since the Body left the ground; 0 on the ground. */
  readonly fallingDistance: number;
  /** Air left, 0 to 20 bubbles; 20 when the Body is not underwater. */
  readonly air: number;
  /** Names of the foods the Body carries (any item the registry lists as food), one per stack. */
  edibleFoods(): string[];
  /**
   * Blocks of open air below the cell lookahead blocks ahead of the Body's horizontal motion
   * (default 1); 0 when the Body stands still, a wall is in the way, or the drop ends in water.
   * Capped at MAX_DROP_SCAN.
   */
  dropAhead(lookahead?: number): number;
  /**
   * Physics ticks since the Body's health last dropped, or null when it has not dropped since the
   * view was made. Optional so a hand-built view (a test fake) may leave it out.
   */
  readonly ticksSinceHurt?: number | null;
  /** The bed or world spawn the Body treats as safe, or null when it knows none. */
  readonly safeSpot?: SafeSpot | null;
  /**
   * True at night or in a thunderstorm (the window sleep uses). Optional so a view without a clock
   * can omit it; a reflex reads a missing value as false.
   */
  readonly isNight?: boolean;
  /** True while the pathfinder holds a goal (the Body is walking a planned route). Optional like isNight. */
  readonly pathfinding?: boolean;
  /** True when a bed stands within 32 blocks. Optional like isNight. */
  readonly bedNearby?: boolean;
  /** True when solid blocks close the Body's cell on every side, above and below. Optional like isNight. */
  readonly enclosed?: boolean;
}

/** The deepest drop dropAhead measures, in blocks. */
export const MAX_DROP_SCAN = 32;

/** A `BodyView` that tracks falls by listening to the bot; `dispose` removes the listener. */
export interface TrackedBodyView extends BodyView {
  dispose(): void;
}

const DEFAULT_HOSTILE_RADIUS = 16;
/** A mob within this many blocks can melee the Body. */
const MELEE_REACH = 4;
/** Cosine of the half-angle (60 degrees) within which a mob counts as facing the Body. */
const FACING_COS = 0.5;
/** World ticks a bed read stays valid: the bed scan walks a 32 block radius. */
const BED_CACHE_TICKS = 20;
/** Plants that grow in water: a Body in them is in water though the cell is not named water. */
const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column']);
/** How far a bed counts as near, in blocks (the range sleep searches). */
const BED_RADIUS = 32;
/** The cells that must be solid for the Body to count as enclosed: four at feet and head level, above, below. */
const ENCLOSURE: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(1, 1, 0),
  new Vec3(-1, 1, 0),
  new Vec3(0, 1, 1),
  new Vec3(0, 1, -1),
  new Vec3(0, 2, 0),
  new Vec3(0, -1, 0),
];

/** One of the physics plugin's boolean flags on the bot's entity (the typings omit them). */
function entityFlag(bot: Bot, flag: 'isInWater' | 'isInLava'): boolean {
  return (bot.entity as unknown as Record<string, unknown>)[flag] === true;
}

/** True when the entity's body yaw points at `target` within the facing cone (horizontal only). */
function isFacing(entity: { position: Vec3; yaw?: number }, target: Vec3): boolean {
  const dx = target.x - entity.position.x;
  const dz = target.z - entity.position.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return true;
  const yaw = entity.yaw ?? 0;
  // mineflayer's forward vector for a yaw is (-sin yaw, -cos yaw): yaw 0 faces north (-z).
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / length >= FACING_COS;
}

/**
 * Builds the read-only view of a bot. The fall distance needs a sample every physics tick, so the
 * view listens to `physicsTick` until `dispose()`.
 */
export function createBodyView(bot: Bot): TrackedBodyView {
  let peakY = bot.entity.position.y;
  let sinceHurt: number | null = null;
  const sample = (): void => {
    const y = bot.entity.position.y;
    peakY = bot.entity.onGround ? y : Math.max(peakY, y);
    if (sinceHurt !== null) sinceHurt += 1;
  };
  bot.on('physicsTick', sample);
  let lastHealth = bot.health;
  const onHealth = (): void => {
    if (bot.health < lastHealth) sinceHurt = 0;
    lastHealth = bot.health;
  };
  bot.on('health', onHealth);
  const safeSpots = trackSafeSpot(bot);
  let bedRead: { tick: number; near: boolean } | null = null;

  return {
    get tick() {
      return worldAge(bot);
    },
    get health() {
      return Math.min(20, bot.health);
    },
    get hunger() {
      return bot.food;
    },
    get position() {
      const p = bot.entity.position;
      return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    },
    nearbyHostiles(radius = DEFAULT_HOSTILE_RADIUS) {
      const here = bot.entity.position;
      const found: HostileView[] = [];
      for (const entity of Object.values(bot.entities)) {
        if (entity === bot.entity || entity.type !== 'hostile') continue;
        const distance = entity.position.distanceTo(here);
        if (distance > radius) continue;
        const { x, y, z } = entity.position;
        found.push({
          name: entity.name ?? 'unknown',
          distance,
          position: { x, y, z },
          attacking: distance <= MELEE_REACH && isFacing(entity, here),
        });
      }
      return found.sort((a, b) => a.distance - b.distance);
    },
    inventoryCount(item) {
      return bot.inventory
        .items()
        .filter((stack) => stack.name === item)
        .reduce((sum, stack) => sum + stack.count, 0);
    },
    get inFluid() {
      const block = bot.blockAt(bot.entity.position);
      if (entityFlag(bot, 'isInLava') || block?.name === 'lava') return 'lava';
      if (entityFlag(bot, 'isInWater') || block?.name === 'water') return 'water';
      if (block !== null && WATER_PLANTS.has(block.name)) return 'water';
      return null;
    },
    get onFire() {
      // Bit 0 of the entity flags metadata (index 0) is on fire.
      const flags: unknown = bot.entity.metadata?.[0];
      return typeof flags === 'number' && (flags & 1) === 1;
    },
    get fallingDistance() {
      if (bot.entity.onGround) return 0;
      return Math.max(0, peakY - bot.entity.position.y);
    },
    get air() {
      return bot.oxygenLevel ?? 20;
    },
    edibleFoods() {
      const foods = bot.registry.foodsByName;
      return bot.inventory
        .items()
        .filter((stack) => foods[stack.name] !== undefined)
        .map((stack) => stack.name);
    },
    dropAhead(lookahead = 1) {
      const { x: vx, z: vz } = bot.entity.velocity;
      const speed = Math.hypot(vx, vz);
      if (speed < 0.01) return 0;
      const here = bot.entity.position;
      const ahead = here.offset((vx / speed) * lookahead, 0, (vz / speed) * lookahead);
      const floorY = Math.floor(here.y) - 1;
      // A solid block at foot level ahead is a wall, not an edge.
      if (bot.blockAt(ahead.offset(0, 0.5, 0))?.boundingBox === 'block') return 0;
      let drop = 0;
      while (drop < MAX_DROP_SCAN) {
        const block = bot.blockAt(ahead.set(ahead.x, floorY - drop, ahead.z));
        if (!block) return 0;
        if (block.name === 'water') return 0;
        if (block.boundingBox !== 'empty') break;
        drop += 1;
      }
      return drop;
    },
    get ticksSinceHurt() {
      return sinceHurt;
    },
    get safeSpot() {
      return safeSpots.current();
    },
    get pathfinding() {
      const loaded: unknown = (bot as { pathfinder?: unknown }).pathfinder;
      return loaded ? bot.pathfinder.goal !== null && bot.pathfinder.goal !== undefined : false;
    },
    get isNight() {
      return isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0);
    },
    get bedNearby() {
      const tick = worldAge(bot);
      if (
        tick !== null &&
        bedRead !== null &&
        tick - bedRead.tick < BED_CACHE_TICKS &&
        tick >= bedRead.tick
      ) {
        return bedRead.near;
      }
      const near =
        bot.findBlock({
          matching: (block) => block.name.endsWith('_bed'),
          maxDistance: BED_RADIUS,
        }) !== null;
      bedRead = tick === null ? null : { tick, near };
      return near;
    },
    get enclosed() {
      const feet = bot.entity.position.floored();
      return ENCLOSURE.every((o) => bot.blockAt(feet.plus(o))?.boundingBox === 'block');
    },
    dispose() {
      bot.off('physicsTick', sample);
      bot.off('health', onHealth);
      safeSpots.dispose();
    },
  };
}
