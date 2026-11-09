import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Where the Body last knew it was safe: the bed it slept in, else the world spawn. */
export interface SafeSpot {
  kind: 'bed' | 'spawn';
  /** Block coordinates. */
  position: { x: number; y: number; z: number };
}

/** The Body's memory of its safe spot; `dispose` removes the bot listener. */
export interface SafeSpotMemory {
  /** The bed if one is remembered and still there, else the world spawn, else null. */
  current(): SafeSpot | null;
  dispose(): void;
}

/**
 * Remembers the bed the Body slept in (from the bot's `sleep` event) and reads the world spawn from
 * the bot at call time. A remembered bed is forgotten once its chunk is loaded and no bed stands
 * there. This is the Body's own memory, not something the server supplies.
 */
export function trackSafeSpot(bot: Bot): SafeSpotMemory {
  let bed: SafeSpot['position'] | null = null;
  const onSleep = (): void => {
    const p = bot.entity.position;
    bed = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  };
  bot.on('sleep', onSleep);

  return {
    current() {
      if (bed) {
        const block = bot.blockAt(new Vec3(bed.x, bed.y, bed.z));
        // `null` means the chunk is not loaded: keep the memory. A loaded block that is no bed ends it.
        if (block === null || block.name.endsWith('_bed')) {
          return { kind: 'bed', position: { ...bed } };
        }
        bed = null;
      }
      const spawn: { x: number; y: number; z: number } | undefined = bot.spawnPoint;
      if (!spawn) return null;
      return {
        kind: 'spawn',
        position: { x: Math.floor(spawn.x), y: Math.floor(spawn.y), z: Math.floor(spawn.z) },
      };
    },
    dispose() {
      bot.off('sleep', onSleep);
    },
  };
}
