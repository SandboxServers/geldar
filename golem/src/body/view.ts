import type { Bot } from 'mineflayer';
import { worldAge } from '../world-clock.ts';
import { type SafeSpot, trackSafeSpot } from './safe-spot.ts';

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
}

/** The deepest drop dropAhead measures, in blocks. */
export const MAX_DROP_SCAN = 32;

/** A `BodyView` that tracks falls by listening to the bot; `dispose` removes the listener. */
export interface TrackedBodyView extends BodyView {
  dispose(): void;
}

const DEFAULT_HOSTILE_RADIUS = 16;

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
    dispose() {
      bot.off('physicsTick', sample);
      bot.off('health', onHealth);
      safeSpots.dispose();
    },
  };
}
