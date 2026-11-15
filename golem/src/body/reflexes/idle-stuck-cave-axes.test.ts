import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import type { BodyView } from '../view.ts';
import { boxedDigGuard } from './idle-stuck-boxed.ts';
import { GridWorld } from './reflexes.fakes.ts';

/** The Body's feet cell: open air in a stone world. Every dig step starts one cell away from it. */
const FEET = new Vec3(0, 64, 0);

/** The six directions a dig step can take from the feet, as unit vectors. */
const SIX: [string, Vec3][] = [
  ['east (+x)', new Vec3(1, 0, 0)],
  ['west (-x)', new Vec3(-1, 0, 0)],
  ['north (-z)', new Vec3(0, 0, -1)],
  ['south (+z)', new Vec3(0, 0, 1)],
  ['up (+y)', new Vec3(0, 1, 0)],
  ['down (-y)', new Vec3(0, -1, 0)],
];

/** The four unit vectors perpendicular to `dir`: the plane across a dig step. */
function planeOf(dir: Vec3): Vec3[] {
  const all = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 1, 0),
    new Vec3(0, -1, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];
  return all.filter((u) => u.x * dir.x + u.y * dir.y + u.z * dir.z === 0);
}

const key = (at: Vec3): string => `${at.x},${at.y},${at.z}`;

interface Scene {
  world: GridWorld;
  /** Cells whose sky light is read as 0 (underground). */
  dark: Set<string>;
  /** Cells the view has not loaded: its read is null. */
  unknown: Set<string>;
}

/** Stone all around the feet, the feet cell open to the sky. */
function stoneScene(): Scene {
  const world = new GridWorld();
  world.fill(new Vec3(-4, 56, -4), new Vec3(4, 72, 4), 'stone');
  world.fill(FEET, FEET, null);
  return { world, dark: new Set(), unknown: new Set() };
}

/** The Body's view of a scene: its feet, and the terrain read with the sky light and unknown cells it holds. */
function viewOf(scene: Scene): BodyView {
  return {
    position: { x: FEET.x, y: FEET.y, z: FEET.z },
    health: 20,
    terrainAt: (at: Vec3) => {
      if (scene.unknown.has(key(at))) return null;
      const block = scene.world.blockAt(at);
      return { ...block, skyLight: scene.dark.has(key(at)) ? 0 : 15 } as unknown as Block;
    },
  } as unknown as BodyView;
}

/** Open air (lit from the sky) at a cell. */
function openAir(scene: Scene, at: Vec3): void {
  scene.world.fill(at, at, null);
}

/** An unlit void at a cell: air with no sky light. */
function voidAt(scene: Scene, at: Vec3): void {
  openAir(scene, at);
  scene.dark.add(key(at));
}

/** The guard's verdict (true refuses) on digging the block one cell from the feet in `dir`. */
function refuses(scene: Scene, dir: Vec3): boolean {
  return boxedDigGuard(viewOf(scene))({ position: FEET.plus(dir) });
}

beforeEach(() => {
  vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SIX)('idle_stuck cave mouth refusal, dig to the %s (decision 0336)', (_name, dir) => {
  // Built fresh each call: vec3's scale() mutates its receiver, so scaling the shared `dir` would drift it.
  const beyond = (): Vec3 => FEET.plus(new Vec3(dir.x * 2, dir.y * 2, dir.z * 2));

  it('allows a dig whose cell beyond is solid stone', () => {
    expect(refuses(stoneScene(), dir)).toBe(false);
  });

  it('allows a dig onto open air lit from the sky', () => {
    const scene = stoneScene();
    openAir(scene, beyond());
    expect(refuses(scene, dir)).toBe(false);
  });

  it('refuses a dig onto an unlit void beyond', () => {
    const scene = stoneScene();
    voidAt(scene, beyond());
    expect(refuses(scene, dir)).toBe(true);
  });

  it('refuses a dig onto sky-lit air with an unlit void in either cell of its plane', () => {
    for (const side of planeOf(dir)) {
      const scene = stoneScene();
      openAir(scene, beyond());
      voidAt(scene, beyond().plus(side));
      expect(refuses(scene, dir)).toBe(true);
    }
  });

  it.skipIf(dir.y === 1)(
    'refuses a dig onto sky-lit air with air three cells below it (a 3-block drop)',
    () => {
      const scene = stoneScene();
      openAir(scene, beyond());
      for (let n = 1; n <= 3; n++) openAir(scene, beyond().offset(0, -n, 0));
      expect(refuses(scene, dir)).toBe(true);
    },
  );

  it('refuses when the cell beyond is not loaded (unknown counts as refused)', () => {
    const scene = stoneScene();
    scene.unknown.add(key(beyond()));
    expect(refuses(scene, dir)).toBe(true);
  });

  it('refuses when a cell in the plane beyond is not loaded', () => {
    const scene = stoneScene();
    openAir(scene, beyond());
    scene.unknown.add(key(beyond().plus(planeOf(dir)[0] as Vec3)));
    expect(refuses(scene, dir)).toBe(true);
  });
});

// The dig_up rung's second cell is the one above the head: feet + the step + two up. It is an upward dig, so the
// guard reads the cell above it (classified up by digDirection), not the cell beside it.
describe('idle_stuck cave mouth, the dig_up second cell is an upward dig (decision 0336)', () => {
  const SECOND = new Vec3(1, 2, 0);

  it('refuses the second cell when the void is above it', () => {
    const scene = stoneScene();
    voidAt(scene, FEET.plus(new Vec3(1, 3, 0)));
    expect(refuses(scene, SECOND)).toBe(true);
  });

  it('allows the second cell when the void is only beside it (not in its upward dig)', () => {
    const scene = stoneScene();
    voidAt(scene, FEET.plus(new Vec3(2, 2, 0)));
    expect(refuses(scene, SECOND)).toBe(false);
  });
});
