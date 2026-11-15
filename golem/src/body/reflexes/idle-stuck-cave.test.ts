import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import { dig, setDigGuard } from '../../actions/unstick.ts';
import type { BodyView } from '../view.ts';
import { boxedDigGuard } from './idle-stuck-boxed.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';

const SPOT = { x: 0, y: 64, z: 0 };

/** The 7-cell air pocket at the origin, the same shape as the boxed-in pocket. */
const POCKET: [number, number, number][] = [
  [0, 64, 0],
  [1, 64, 0],
  [-1, 64, 0],
  [0, 64, 1],
  [0, 64, -1],
  [0, 65, 0],
  [1, 65, 0],
];

/** Sky light per cell: open air is lit from the sky (15), an underground cell is not (0). */
type SkyAt = (at: Vec3) => number | undefined;
const SURFACE: SkyAt = () => 15;

/**
 * Solid stone from x -2 to 6, y 60 to 66, z -2 to 2, with the pocket carved out. The east wall of the pocket
 * (x 2) has solid stone beyond it: a dig there opens nothing.
 */
function stoneWorld(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-2, 60, -2), new Vec3(6, 66, 2), 'stone');
  for (const [x, y, z] of POCKET) world.fill(new Vec3(x, y, z), new Vec3(x, y, z), null);
  return world;
}

/** A bot whose `dig` clears the block it digs in `world`. */
function digBot(world: GridWorld): Parameters<typeof dig>[0] {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (at: Vec3) => world.blockAt(at),
    dig: vi.fn(async (block: { position: Vec3 }) => {
      world.fill(block.position, block.position, null);
    }),
    equip: vi.fn(async () => undefined),
  };
  return bot as unknown as Parameters<typeof dig>[0];
}

/** A still Body in the pocket of `world`, reading its terrain with the sky light `sky` gives each cell. */
function bodyIn(world: GridWorld, sky: SkyAt = SURFACE): BodyView {
  return Object.assign(settableView(), {
    tick: 0,
    position: { ...SPOT },
    health: 20,
    terrainAt: (at: Vec3) => {
      const block = world.blockAt(at);
      return { ...block, skyLight: sky(at) } as unknown as Block;
    },
  }) as unknown as BodyView;
}

/** One dig step at `cell`, as a boxed run takes it. */
function digAt(bot: Parameters<typeof dig>[0], cell: Vec3): Promise<boolean> {
  return dig(
    bot,
    new AbortController().signal,
    { name: 'stone', position: cell } as never,
    SPOT as never,
  );
}

/** The operator log lines that carry a refused dig step. */
function refusals(logs: { mock: { calls: unknown[][] } }): string[] {
  return logs.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes('dig refused'));
}

/** Air (open to the sky) from x 3 to 6, y 64 to 66: the surface ground beyond the east wall. */
function surfaceGround(world: GridWorld): void {
  world.fill(new Vec3(3, 64, -2), new Vec3(6, 66, 2), null);
}

/** Air from x 3 to 6, y 64 to 66, with no sky: a roofed void, a cave beyond the east wall. */
function undergroundVoid(world: GridWorld): void {
  world.fill(new Vec3(3, 64, -2), new Vec3(6, 66, 2), null);
}

/** Sky light for `world` where `dark` says a cell is underground (no sky), and open air elsewhere. */
function skyWhere(dark: (at: Vec3) => boolean): SkyAt {
  return (at) => (dark(at) ? 0 : 15);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idle_stuck boxed-in cave mouth refusal (decision 0336, narrowed)', () => {
  it('allows a dig into a solid stone wall with solid stone beyond', async () => {
    const world = stoneWorld();
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot, boxedDigGuard(bodyIn(world)));
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(true);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(refusals(logs)).toEqual([]);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('allows a dig out onto open surface ground with sky light', async () => {
    const world = stoneWorld();
    surfaceGround(world);
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot, boxedDigGuard(bodyIn(world, SURFACE)));
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(true);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(refusals(logs)).toEqual([]);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('refuses a dig into an underground void with no sky light, with reason cave_mouth', async () => {
    const world = stoneWorld();
    undergroundVoid(world);
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(
      bot,
      boxedDigGuard(
        bodyIn(
          world,
          skyWhere((at) => at.x >= 3),
        ),
      ),
    );
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(false);
      expect(bot.dig).not.toHaveBeenCalled();
      expect(refusals(logs).some((line) => line.includes('"reason":"cave_mouth"'))).toBe(true);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('refuses a dig into an unlit void whose sky light is not read (unknown counts as underground)', async () => {
    const world = stoneWorld();
    surfaceGround(world);
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot, boxedDigGuard(bodyIn(world, () => undefined)));
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(false);
      expect(bot.dig).not.toHaveBeenCalled();
      expect(refusals(logs).some((line) => line.includes('"reason":"cave_mouth"'))).toBe(true);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('refuses a 3-block drop beyond the block even at the surface edge, with reason cave_mouth', async () => {
    const world = stoneWorld();
    surfaceGround(world);
    // A shaft of open-sky air at x 3 from y 61 to 63 under the surface cell beyond the wall.
    world.fill(new Vec3(3, 61, 0), new Vec3(3, 63, 0), null);
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot, boxedDigGuard(bodyIn(world, SURFACE)));
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(false);
      expect(bot.dig).not.toHaveBeenCalled();
      expect(refusals(logs).some((line) => line.includes('"reason":"cave_mouth"'))).toBe(true);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('allows a 2-block drop beyond the block at the surface (below the 3-block line)', async () => {
    const world = stoneWorld();
    surfaceGround(world);
    // Air from y 62 to 64: two air cells under the beyond cell; the cell at y 61 is stone.
    world.fill(new Vec3(3, 62, 0), new Vec3(3, 63, 0), null);
    const bot = digBot(world);
    setDigGuard(bot, boxedDigGuard(bodyIn(world, SURFACE)));
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(true);
      expect(bot.dig).toHaveBeenCalledTimes(1);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('refuses the next dig step when an underground void is revealed by the step before it', async () => {
    const world = stoneWorld();
    const bot = digBot(world);
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(
      bot,
      boxedDigGuard(
        bodyIn(
          world,
          skyWhere((at) => at.x >= 3),
        ),
      ),
    );
    try {
      expect(await digAt(bot, new Vec3(2, 64, 0))).toBe(true);
      // The terrain is read again at each step, so the void the first dig reveals refuses the next one.
      undergroundVoid(world);
      expect(await digAt(bot, new Vec3(2, 64, 1))).toBe(false);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(refusals(logs).some((line) => line.includes('"reason":"cave_mouth"'))).toBe(true);
    } finally {
      setDigGuard(bot, null);
    }
  });
});
