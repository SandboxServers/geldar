import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isNightOrStorm } from '../actions/sleep.ts';
import { worldAge } from '../world-clock.ts';

/** A hostile mob near the Body. */
export interface HostileView {
  /** Mineflayer's mob name, for example `zombie`. */
  name: string;
  /** Straight-line distance from the Body in blocks. */
  distance: number;
  position: { x: number; y: number; z: number };
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
  /**
   * True at night or in a thunderstorm (the window sleep uses). Optional so a view without a clock
   * can omit it; a reflex reads a missing value as false.
   */
  readonly isNight?: boolean;
  /** True when a bed stands within 32 blocks. Optional like isNight. */
  readonly bedNearby?: boolean;
  /** True when solid blocks close the Body's cell on every side, above and below. Optional like isNight. */
  readonly enclosed?: boolean;
}

/** A `BodyView` that tracks falls by listening to the bot; `dispose` removes the listener. */
export interface TrackedBodyView extends BodyView {
  dispose(): void;
}

const DEFAULT_HOSTILE_RADIUS = 16;
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

/**
 * Builds the read-only view of a bot. The fall distance needs a sample every physics tick, so the
 * view listens to `physicsTick` until `dispose()`.
 */
export function createBodyView(bot: Bot): TrackedBodyView {
  let peakY = bot.entity.position.y;
  const sample = (): void => {
    const y = bot.entity.position.y;
    peakY = bot.entity.onGround ? y : Math.max(peakY, y);
  };
  bot.on('physicsTick', sample);

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
        found.push({ name: entity.name ?? 'unknown', distance, position: { x, y, z } });
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
      if (block?.name === 'lava') return 'lava';
      if (block?.name === 'water') return 'water';
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
    get isNight() {
      return isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0);
    },
    get bedNearby() {
      return (
        bot.findBlock({
          matching: (block) => block.name.endsWith('_bed'),
          maxDistance: BED_RADIUS,
        }) !== null
      );
    },
    get enclosed() {
      const feet = bot.entity.position.floored();
      return ENCLOSURE.every((o) => bot.blockAt(feet.plus(o))?.boundingBox === 'block');
    },
    dispose() {
      bot.off('physicsTick', sample);
    },
  };
}
