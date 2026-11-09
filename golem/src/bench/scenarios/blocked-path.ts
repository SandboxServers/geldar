import { Vec3 } from 'vec3';
import { waitUntil } from '../runner.ts';
import type { Scenario } from '../types.ts';

/** `detour`: the wall has a gap, so a detour exists. `sealed`: it has none, so the Body must abandon with `blocked`. */
export type Variant = 'detour' | 'sealed';
/** What happened to the `goto`, as the verdict names it. */
export type Outcome = 'detoured' | 'abandoned' | 'wall_failed' | 'bad';

/** Distance of the goal from the start (arena center) along x. */
const GOAL_DX = 14;
/** The wall stands at this x offset, 4 high and as wide as the platform. */
const WALL_DX = 9;
const WALL_HEIGHT = 4;
/** The platform is 31 wide: z offsets -15 to +15. */
const HALF_WIDTH = 15;
/** The gap of the `detour` wall. */
const GAP_DZ = 12;
/** The wall goes up once the bot is this far (x offset) on its way. */
const BUILD_AFTER_DX = 2;
/** World ticks to wait for the bot to get that far. */
const WALK_WAIT_TICKS = 600;
/** Terrain beside the platform is checked this far out. */
const BESIDE_DZ = 16;

/** The variant of the next run. Even runs detour, odd runs are sealed. */
let runs = 0;
let current: Variant = 'detour';

/** Restarts the even/odd alternation (the live test and unit tests start from `detour`). */
export function resetBlockedPathRuns(): void {
  runs = 0;
}

/** Pure verdict of one run from the `goto` result. */
export function blockedVerdict(
  variant: Variant,
  result: { status: string; reason?: string | null },
): { passed: boolean; outcome: Outcome } {
  if (result.status === 'completed') {
    return variant === 'detour'
      ? { passed: true, outcome: 'detoured' }
      : { passed: false, outcome: 'wall_failed' };
  }
  if (result.status === 'failed' && result.reason === 'blocked') {
    return { passed: true, outcome: 'abandoned' };
  }
  return { passed: false, outcome: 'bad' };
}

/**
 * A wall goes up across the way while the bot walks toward a goal behind it. With a gap the Body
 * may detour or abandon with `blocked`; without one it must abandon (spec 5.2 reflex "path blocked").
 */
export const blockedPath: Scenario = {
  name: 'blocked-path',
  description:
    'a wall rises across the path to the goal: detour through a gap, or give up as blocked',
  timeoutMs: 150_000,
  async prepare() {
    // Nothing is built yet: the wall goes up while the bot is on its way. The fixture is the empty arena.
    current = runs % 2 === 0 ? 'detour' : 'sealed';
    runs++;
  },
  ready: () => true,
  async run(env) {
    const { bot, ctl } = env;
    const { center } = env.arena;
    const variant = current;
    const goal = { x: center.x + GOAL_DX, y: center.y, z: center.z };
    // Not awaited yet: the wall must appear while the walk is under way.
    const walk = env.run({ do: 'goto', target: goal });
    // No unhandled rejection if the wait below throws first.
    walk.catch(() => undefined);
    const underway = await waitUntil(
      env,
      () => bot.entity.position.x > center.x + BUILD_AFTER_DX,
      WALK_WAIT_TICKS,
    );
    if (!underway) {
      const { result } = await walk;
      return {
        passed: false,
        note: `${variant}: the bot never got ${BUILD_AFTER_DX} blocks on its way; goto ${result.status}${result.reason ? ` (${result.reason})` : ''}`,
      };
    }
    const x = center.x + WALL_DX;
    const top = center.y + WALL_HEIGHT - 1;
    const wall = (from: number, to: number) =>
      ctl.fill(
        { x, y: center.y, z: center.z + from },
        { x, y: top, z: center.z + to },
        'stone_bricks',
      );
    if (variant === 'detour') {
      await wall(-HALF_WIDTH, GAP_DZ - 1);
      await wall(GAP_DZ + 1, HALF_WIDTH);
    } else {
      await wall(-HALF_WIDTH, HALF_WIDTH);
    }
    const solidBeside = [BESIDE_DZ, -BESIDE_DZ].some((dz) =>
      [center.y, center.y + 1].some(
        (y) => bot.blockAt(new Vec3(x, y, center.z + dz))?.boundingBox === 'block',
      ),
    );
    const { result } = await walk;
    const { passed, outcome } = blockedVerdict(variant, result);
    const text = `${variant}: goto ${result.status}${result.reason ? ` (${result.reason})` : ''} in ${result.latency_ms} ms -> ${outcome}`;
    if (solidBeside) {
      return {
        passed: false,
        note: `invalid, ${text}: terrain beside the platform lets the bot walk around the wall`,
      };
    }
    const wallNote = outcome === 'wall_failed' ? ', the wall did not hold' : '';
    return { passed, note: `${text}${wallNote}` };
  },
};
