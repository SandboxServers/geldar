import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import { dig } from '../../actions/unstick.ts';
import { fakeBot } from '../body.fakes.ts';
import type { ReflexContext, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { idleStuckReflex } from './idle-stuck.ts';
import { BOXED_COOLDOWN_TICKS, BOXED_RUNS_PER_HOUR, BOXED_TICKS } from './idle-stuck-boxed.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';
import { noteGoto } from './unstick.ts';

/** A stone floor at y 63 under open ground, wide enough that the walks never meet its edge. */
function openGround(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
  return world;
}

/**
 * The open ground with a closed 7-cell air pocket at the origin (the shape of Tommy's pocket), walled, roofed
 * and floored in stone. The terrain is built here, not read off the server.
 */
function pocketWorld(): GridWorld {
  const world = openGround();
  world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
  const air: [number, number, number][] = [
    [0, 64, 0],
    [1, 64, 0],
    [-1, 64, 0],
    [0, 64, 1],
    [0, 64, -1],
    [0, 65, 0],
    [1, 65, 0],
  ];
  for (const [x, y, z] of air) world.fill(new Vec3(x, y, z), new Vec3(x, y, z), null);
  return world;
}

const SPOT = { x: 0, y: 64, z: 0 };
const FEET = new Vec3(0, 64, 0);

/** The fake bot on `world`: its blocks read from the world, and a dig that clears the block it digs. */
function runBot(world: GridWorld) {
  return Object.assign(fakeBot(), {
    entity: { position: FEET.clone() },
    blockAt: (at: Vec3) => world.blockAt(at),
    dig: vi.fn(async (block: { position: Vec3 }) => {
      world.fill(block.position, block.position, null);
    }),
    equip: vi.fn(async () => undefined),
  });
}

/** A still Body on the floor of `world`, not on its own placement, with no Mind action, awake, dry and in daylight. */
function bodyIn(world: GridWorld): BodyView {
  return Object.assign(settableView(), {
    tick: 0,
    position: { ...SPOT },
    health: 20,
    enclosed: false,
    canStepOff: true,
    noSafeExit: false,
    onOwnPlacement: false,
    isNight: false,
    actionRunning: false,
    asleep: false,
    riding: false,
    inFluid: null,
    terrainAt: (at: Vec3) => world.blockAt(at) as unknown as Block,
  }) as unknown as BodyView;
}

function at(view: BodyView, tick: number): BodyView {
  (view as unknown as { tick: number }).tick = tick;
  return view;
}

/** A goto that ended `failed(blocked)` where the Body stands. */
function blockedWalk(view: BodyView): void {
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, SPOT);
}

/** A registry whose `unstick` handler is `handler`; the reflex runs it through `runAction`. */
function unstickRegistry(
  handler: () => Promise<ReturnType<typeof completed> | ReturnType<typeof failed>>,
) {
  const registry = new ActionRegistry();
  registry.register({ kind: 'unstick', timeoutMs: 1000, run: async () => handler() });
  return registry;
}

function ctxFor(
  view: BodyView,
  registry: ActionRegistry,
  bot: unknown,
  tick: number,
): ReflexContext {
  (view as unknown as { tick: number }).tick = tick;
  return {
    bot,
    view,
    registry,
    tick,
    timeScale: 1,
    signal: new AbortController().signal,
    cancelAction: async () => {},
  } as unknown as ReflexContext;
}

/** Scans the still ticks from `from` in 100-tick steps for the first tick the trigger fires; null if none in `span`. */
function nextBoxedTick(
  view: BodyView,
  from: number,
  span = 100_000,
): { tick: number; trigger: Trigger } | null {
  for (let t = from; t <= from + span; t += 100) {
    const trigger = idleStuckReflex.check(at(view, t));
    if (trigger) return { tick: t, trigger };
  }
  return null;
}

/** The Body after two blocked walks from its spot, with the idle clock started (the first check sets the anchor). */
function boxedView(world: GridWorld): BodyView {
  const view = bodyIn(world);
  blockedWalk(view);
  blockedWalk(view);
  idleStuckReflex.check(view);
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idle_stuck boxed-in run: the guard is installed (decision 0336)', () => {
  it('a dig beside lava revealed by the first dig is refused and logged, through the reflex run', async () => {
    const world = pocketWorld();
    const bot = runBot(world);
    const signal = new AbortController().signal;
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    const view = boxedView(world);
    const trigger = idleStuckReflex.check(at(view, BOXED_TICKS));
    expect(trigger?.reason).toBe('boxed_in');
    const digs: boolean[] = [];
    const registry = unstickRegistry(async () => {
      digs.push(
        await dig(
          bot,
          signal,
          { name: 'stone', position: new Vec3(2, 64, 0) } as never,
          SPOT as never,
        ),
      );
      // The first dig exposes lava one cell past the wall: the next step, beside it, must be refused.
      world.fill(new Vec3(3, 64, 0), new Vec3(3, 64, 0), 'lava');
      digs.push(
        await dig(
          bot,
          signal,
          { name: 'stone', position: new Vec3(2, 64, 1) } as never,
          SPOT as never,
        ),
      );
      return digs.every(Boolean) ? completed({ method: 'dig' }) : failed('blocked', 'dig refused');
    });
    const outcome = await idleStuckReflex.run(
      trigger as NonNullable<typeof trigger>,
      ctxFor(view, registry, bot, BOXED_TICKS),
    );
    expect(digs).toEqual([true, false]);
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls.some(([line]) => String(line).includes('"result":"dig refused"'))).toBe(
      true,
    );
    expect(outcome.detail).toContain('idle_stuck (boxed_in) attempt 1 of');
    // The guard is cleared when the run ends: a later dig on its own is not refused.
    expect(
      await dig(
        bot,
        signal,
        { name: 'stone', position: new Vec3(2, 64, 1) } as never,
        SPOT as never,
      ),
    ).toBe(true);
  });
});

describe('idle_stuck boxed-in run: the liquid precheck (decision 0336)', () => {
  it.each([
    ['lava diagonal below the feet', new Vec3(1, 63, -1), 'lava'],
    ['water beside the feet', new Vec3(-1, 64, 0), 'water'],
    ['lava in the head cell above', new Vec3(0, 66, 0), 'lava'],
    ['water two above the feet', new Vec3(0, 66, 1), 'water'],
  ])('refuses the attempt before the first dig with %s', async (_name, cell, liquid) => {
    const world = pocketWorld();
    world.fill(cell, cell, liquid);
    const bot = runBot(world);
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    const view = boxedView(world);
    const trigger = idleStuckReflex.check(at(view, BOXED_TICKS));
    expect(trigger?.reason).toBe('boxed_in');
    const handler = vi.fn(async () => completed({ method: 'dig' }));
    const registry = unstickRegistry(handler);
    const outcome = await idleStuckReflex.run(
      trigger as NonNullable<typeof trigger>,
      ctxFor(view, registry, bot, BOXED_TICKS),
    );
    expect(outcome.result).toBe('abandoned');
    expect(outcome.detail).toContain(`dig refused, ${liquid} beside the body`);
    expect(handler).not.toHaveBeenCalled();
    expect(bot.dig).not.toHaveBeenCalled();
  });
});

describe('idle_stuck boxed-in run, end to end on the 7-cell pocket (decision 0336)', () => {
  it('fires at 120 s, digs with the guard, logs one attempt per attempt, and caps the seventh', async () => {
    const world = pocketWorld();
    const bot = runBot(world);
    const signal = new AbortController().signal;
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    const view = boxedView(world);
    // Interior stone only: the walls stay whole, so the pocket stays closed and boxed in.
    const interior = [
      new Vec3(1, 64, 1),
      new Vec3(-1, 64, 1),
      new Vec3(1, 64, -1),
      new Vec3(-1, 64, -1),
      new Vec3(1, 65, 1),
      new Vec3(-1, 65, -1),
    ];
    let next = 0;
    const registry = unstickRegistry(async () => {
      const position = interior[next++];
      const ok = await dig(bot, signal, { name: 'stone', position } as never, SPOT as never);
      return ok ? completed({ method: 'dig' }) : failed('blocked', 'dig refused');
    });
    // `last` is the tick of the previous attempt (0 before the first).
    let last = 0;
    let from = BOXED_TICKS;
    for (let attempt = 1; attempt <= BOXED_RUNS_PER_HOUR; attempt++) {
      const hit = nextBoxedTick(view, from);
      expect(hit?.trigger.reason).toBe('boxed_in');
      if (!hit) return;
      if (attempt === 1) expect(hit.tick).toBe(BOXED_TICKS);
      else {
        // Each attempt waits out the 5 min cooldown (the scan steps 100 ticks).
        expect(hit.tick - last).toBeGreaterThanOrEqual(BOXED_COOLDOWN_TICKS);
        expect(hit.tick - last).toBeLessThan(BOXED_COOLDOWN_TICKS + 100);
      }
      const outcome = await idleStuckReflex.run(hit.trigger, ctxFor(view, registry, bot, hit.tick));
      expect(outcome.result).toBe('handled');
      expect(outcome.detail).toContain(`attempt ${attempt} of ${BOXED_RUNS_PER_HOUR} this hour`);
      last = hit.tick;
      from = hit.tick + 1;
    }
    expect(bot.dig).toHaveBeenCalledTimes(BOXED_RUNS_PER_HOUR);
    const lines = (): string[] => logs.mock.calls.map(([line]) => String(line));
    expect(lines().some((line) => line.includes('"result":"dig refused"'))).toBe(false);
    // The seventh attempt, inside the hour, is refused by the cap: no run, and one cap line.
    for (let t = last + 1; t <= last + 20_000; t += 100) {
      expect(idleStuckReflex.check(at(view, t))).toBeNull();
    }
    expect(lines().filter((line) => line.includes('"result":"cap reached"'))).toHaveLength(1);
    expect(next).toBe(BOXED_RUNS_PER_HOUR);
  });
});
