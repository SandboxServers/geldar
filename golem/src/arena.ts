import type { Pos, TestControl } from './test-control.ts';

/**
 * A live-test arena: a 31 by 31 stone platform at y = 199 with air above it, far from spawn.
 * Slot n is centered on x = 800 + 64 * n, z = 800, so arenas never overlap.
 */
export interface Arena {
  slot: number;
  /** The platform center on y = 200 (the first air block). */
  center: Pos;
  /** Lowest corner: the platform's stone layer. */
  min: Pos;
  /** Highest corner: the top of the air volume. */
  max: Pos;
}

/** The expected 26.1 gamerule names (decision 0024). */
export const GAMERULES = {
  dayCycle: 'advance_time',
  mobSpawning: 'spawn_mobs',
  weather: 'advance_weather',
} as const;

const HALF_WIDTH = 15;
const STONE_Y = 199;
const AIR_BOTTOM_Y = 200;
const AIR_TOP_Y = 220;
const BASE_X = 800;
const BASE_Z = 800;
const SPACING = 64;
const BUILD_TRIES = 20;
const RETRY_DELAY_MS = 250;

/** Pure: the arena for a slot. */
export function arenaFor(slot: number): Arena {
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new RangeError(`arena slot must be a non-negative integer, got ${slot}`);
  }
  const x = BASE_X + SPACING * slot;
  const z = BASE_Z;
  return {
    slot,
    center: { x, y: AIR_BOTTOM_Y, z },
    min: { x: x - HALF_WIDTH, y: STONE_Y, z: z - HALF_WIDTH },
    max: { x: x + HALF_WIDTH, y: AIR_TOP_Y, z: z + HALF_WIDTH },
  };
}

/**
 * Force-loads the arena and builds its platform and air. Retries while a fill reports that the
 * position is not loaded yet: up to 20 tries, 250 ms apart.
 */
export async function buildArena(ctl: TestControl, slot: number): Promise<Arena> {
  const arena = arenaFor(slot);
  const { min, max } = arena;
  await ctl.forceload(min.x, min.z, max.x, max.z);
  for (let attempt = 1; ; attempt++) {
    const stone = await ctl.fill(
      { x: min.x, y: STONE_Y, z: min.z },
      { x: max.x, y: STONE_Y, z: max.z },
      'stone',
    );
    const air = await ctl.fill(
      { x: min.x, y: AIR_BOTTOM_Y, z: min.z },
      { x: max.x, y: AIR_TOP_Y, z: max.z },
      'air',
    );
    if (!/not loaded/i.test(`${stone}\n${air}`)) return arena;
    if (attempt >= BUILD_TRIES) {
      throw new Error(`arena ${slot} did not build: its chunks stayed unloaded`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

/** Freezes the world for a test: no day cycle, no mob spawning, no weather change, noon, clear. */
export async function quietWorld(ctl: TestControl): Promise<void> {
  for (const rule of Object.values(GAMERULES)) await ctl.gamerule(rule, false);
  await ctl.timeSet('noon');
  await ctl.command('weather clear');
  await ctl.command('difficulty easy');
}

/** The reverse of quietWorld: the three rules back to true, normal difficulty, tick rate 20. */
export async function restoreWorld(ctl: TestControl): Promise<void> {
  for (const rule of Object.values(GAMERULES)) await ctl.gamerule(rule, true);
  await ctl.command('difficulty normal');
  await ctl.tickRate(20);
}
