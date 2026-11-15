import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxedDigGuard } from '../body/reflexes/idle-stuck-boxed.ts';
import { GridWorld } from '../body/reflexes/reflexes.fakes.ts';
import type { BodyView } from '../body/view.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';
import { setDigGuard } from './unstick-guard.ts';
import { digUp } from './unstick-up.ts';

const SPOT = { x: 0, y: 64, z: 0 };

/** Stone from x -2 to 3, y 60 to 68, z -2 to 2, with a two-cell shaft carved at the origin (the Body's pit). */
function shaftWorld(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-2, 60, -2), new Vec3(3, 68, 2), 'stone');
  world.fill(new Vec3(0, 64, 0), new Vec3(0, 65, 0), null);
  return world;
}

/** A bot that climbs east: `dig` clears the block it is given, `setControlState('jump')` lifts it one block. */
function climbBot(world: GridWorld, onDig?: (block: { position: Vec3 }) => void) {
  const bot = {
    entity: { position: new Vec3(SPOT.x, SPOT.y, SPOT.z) },
    blockAt: (at: Vec3) => {
      const block = world.blockAt(at);
      return block === null ? null : { ...block, hardness: 1.5 };
    },
    dig: vi.fn(async (block: { position: Vec3 }) => {
      world.fill(block.position, block.position, null);
      onDig?.(block);
    }),
    equip: vi.fn(async () => undefined),
    lookAt: vi.fn(async () => undefined),
    setControlState: vi.fn((name: string, on: boolean) => {
      if (name === 'jump' && on) bot.entity.position = new Vec3(SPOT.x + 1, SPOT.y + 1, SPOT.z);
    }),
    waitForTicks: vi.fn(async () => undefined),
  };
  return bot;
}

/** The Body's view of `world`: its feet, health, and the terrain read with the sky light `sky` gives each cell. */
function viewOf(world: GridWorld, sky: (at: Vec3) => number): BodyView {
  return {
    position: { ...SPOT },
    health: 20,
    terrainAt: (at: Vec3) => ({ ...world.blockAt(at), skyLight: sky(at) }),
  } as unknown as BodyView;
}

/** One `digUp` climb to the east, as the `dig_up` rung makes it (one direction, the rung's own digs). */
function climbEast(bot: ReturnType<typeof climbBot>) {
  return digUp(
    bot as never,
    new AbortController().signal,
    () => bot.entity.position.floored(),
    [new Vec3(1, 0, 0)],
    Date.now(),
    6,
    false,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dig_up rung under the boxed-in dig guard (decision 0336)', () => {
  it('refuses the second climb dig when a cave mouth opens beyond it after the first dig', async () => {
    const world = shaftWorld();
    // Once the first dig breaks, the cell above the second wall cell is an unlit void: a cave mouth.
    const bot = climbBot(world, (block) => {
      if (block.position.y === 65) world.fill(new Vec3(1, 67, 0), new Vec3(1, 67, 0), null);
    });
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(
      bot as never,
      boxedDigGuard(viewOf(world, (at) => (at.x === 1 && at.y === 67 ? 0 : 15))),
    );
    try {
      const up = await climbEast(bot);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(up.freed).toBe(false);
      expect(up.dug).toBe(1);
      expect(up.blocked).toContain('was not dug');
      const refused = logs.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('dig refused'));
      expect(refused.some((line) => line.includes('"reason":"cave_mouth"'))).toBe(true);
    } finally {
      setDigGuard(bot as never, null);
    }
  });

  it('refuses the second climb dig when lava appears beside it after the first dig', async () => {
    const world = shaftWorld();
    // Lava is revealed one block above the second wall cell when the first dig breaks, inside its 3x3x3.
    const bot = climbBot(world, (block) => {
      if (block.position.y === 65) world.fill(new Vec3(1, 67, 0), new Vec3(1, 67, 0), 'lava');
    });
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot as never, boxedDigGuard(viewOf(world, () => 15)));
    try {
      const up = await climbEast(bot);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(up.freed).toBe(false);
      const refused = logs.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('dig refused'));
      expect(refused.some((line) => line.includes('"reason":"liquid"'))).toBe(true);
    } finally {
      setDigGuard(bot as never, null);
    }
  });
});
