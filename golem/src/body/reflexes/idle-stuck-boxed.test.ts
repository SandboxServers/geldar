import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import { dig, setDigGuard } from '../../actions/unstick.ts';
import type { BodyView } from '../view.ts';
import { idleStuckReflex, noteActionEnd } from './idle-stuck.ts';
import {
  BOXED_COOLDOWN_TICKS,
  BOXED_OWNED_TICKS,
  BOXED_TICKS,
  boxedDigGuard,
  boxedGate,
  boxedWaitTicks,
  isBoxedIn,
  liquidNear,
  noteBoxedAttempt,
  noteCapLogged,
} from './idle-stuck-boxed.ts';
import { GridWorld, settableView } from './reflexes.fakes.ts';
import { noteGoto } from './unstick.ts';

/** A stone floor at y 63 under open ground, wide enough that a 40-cell walk never meets its edge. */
function openGround(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
  return world;
}

/**
 * The open ground with a closed 7-cell air pocket at the origin (a plus on the floor, two cells high at
 * the east), walled, roofed and floored in stone. It has the shape of Tommy's 7-cell pocket; the terrain is
 * built here, not read off the server.
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

/** A bot whose `dig` clears the block it digs in `world`, with the position a dig step reads. */
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

const SPOT = { x: 0, y: 64, z: 0 };

/** A still Body on the floor of `world`, not on its own placement, with no Mind action, awake and dry. */
function bodyIn(world: GridWorld, over: Record<string, unknown> = {}): BodyView {
  return Object.assign(
    settableView(),
    {
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
    },
    over,
  ) as unknown as BodyView;
}

function at(view: BodyView, tick: number): BodyView {
  (view as unknown as { tick: number }).tick = tick;
  return view;
}

/** A goto that ended `failed(blocked)` where the Body stands. */
function blockedWalk(view: BodyView): void {
  noteGoto(view, 'failed', 'blocked', 'partial: goal unreachable', false, SPOT);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idle_stuck boxed-in trigger (decision 0336)', () => {
  it('a closed pocket after two blocked walks is boxed in, and fires at 120 s but not at 60 s', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    expect(isBoxedIn(view, SPOT)).toBe(true);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, 1200))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_TICKS - 1))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 120,
    });
  });

  it('open ground is not boxed in, even after two blocked walks', () => {
    const view = bodyIn(openGround());
    blockedWalk(view);
    blockedWalk(view);
    expect(isBoxedIn(view, SPOT)).toBe(false);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 3))).toBeNull();
  });

  it('a pocket with no failed walk is not boxed in (a Body waiting by choice)', () => {
    const view = bodyIn(pocketWorld());
    expect(isBoxedIn(view, SPOT)).toBe(false);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 3))).toBeNull();
  });

  it('a sleeping Body in a small closed room never fires', () => {
    const view = bodyIn(pocketWorld(), { asleep: true });
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 5))).toBeNull();
  });

  it('a Body with a Mind action running (a pending wait, a build) never fires', () => {
    const view = bodyIn(pocketWorld(), { actionRunning: true });
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    expect(idleStuckReflex.check(at(view, BOXED_TICKS * 3))).toBeNull();
  });

  it('a finished action restarts the 120 s clock', () => {
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    at(view, 5000);
    noteActionEnd(view);
    expect(idleStuckReflex.check(at(view, 6000))).toBeNull();
    expect(idleStuckReflex.check(at(view, 5000 + BOXED_TICKS))).toEqual({
      reason: 'boxed_in',
      idle_seconds: 120,
    });
  });

  it('an owned roofed shelter waits the 300 s clock, and an unroofed own block the 120 s one', () => {
    const roofed = bodyIn(pocketWorld(), { onOwnPlacement: true, roofWithin: () => true });
    const open = bodyIn(pocketWorld(), { onOwnPlacement: true, roofWithin: () => false });
    expect(boxedWaitTicks(roofed)).toBe(BOXED_OWNED_TICKS);
    expect(boxedWaitTicks(open)).toBe(BOXED_TICKS);
  });

  it('a pillar top under a roof does not fire boxed_in before 300 s', () => {
    const view = bodyIn(pocketWorld(), { onOwnPlacement: true, roofWithin: () => true });
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    // The own-placement no_path rule (decision 0332) is separate and still runs at 120 s.
    expect(idleStuckReflex.check(at(view, BOXED_TICKS))?.reason).not.toBe('boxed_in');
    expect(idleStuckReflex.check(at(view, BOXED_OWNED_TICKS - 1))?.reason).not.toBe('boxed_in');
  });
});

describe('idle_stuck boxed-in dig guard (decision 0336)', () => {
  it('refuses a dig with lava beside, below or above the Body', () => {
    const beside = pocketWorld();
    beside.fill(new Vec3(1, 64, 0), new Vec3(1, 64, 0), 'lava');
    expect(liquidNear(bodyIn(beside))).toBe('lava');
    const below = pocketWorld();
    below.fill(new Vec3(0, 63, 0), new Vec3(0, 63, 0), 'lava');
    expect(liquidNear(bodyIn(below))).toBe('lava');
    const above = pocketWorld();
    above.fill(new Vec3(0, 66, 0), new Vec3(0, 66, 0), 'lava');
    expect(liquidNear(bodyIn(above))).toBe('lava');
  });

  it('refuses a dig with water beside or above, and passes a dry pocket', () => {
    const beside = pocketWorld();
    beside.fill(new Vec3(1, 64, 1), new Vec3(1, 64, 1), 'water');
    expect(liquidNear(bodyIn(beside))).toBe('water');
    const above = pocketWorld();
    above.fill(new Vec3(0, 66, 0), new Vec3(0, 66, 0), 'water');
    expect(liquidNear(bodyIn(above))).toBe('water');
    expect(liquidNear(bodyIn(pocketWorld()))).toBeNull();
  });

  it('refuses when no terrain is read', () => {
    const view = bodyIn(pocketWorld(), { terrainAt: undefined });
    expect(liquidNear(view)).toBe('unread');
  });
});

describe('idle_stuck boxed-in attempt gate (decision 0336)', () => {
  it('starts a 5 min cooldown after an attempt', () => {
    const view = bodyIn(pocketWorld());
    expect(BOXED_COOLDOWN_TICKS).toBe(6000);
    noteBoxedAttempt(view, 0);
    expect(boxedGate(view, BOXED_COOLDOWN_TICKS - 1)).toBe('cooldown');
    expect(boxedGate(view, BOXED_COOLDOWN_TICKS)).toBe('ok');
  });

  it('allows the sixth attempt in an hour, and refuses the seventh with one cap line', () => {
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    const view = bodyIn(pocketWorld());
    blockedWalk(view);
    blockedWalk(view);
    idleStuckReflex.check(view);
    // Attempts spaced by the 5 min cooldown: the sixth lands at 25 min, the seventh would be at 30 min.
    for (let attempt = 0; attempt < 5; attempt++)
      noteBoxedAttempt(view, attempt * BOXED_COOLDOWN_TICKS);
    expect(boxedGate(view, 5 * BOXED_COOLDOWN_TICKS)).toBe('ok');
    noteBoxedAttempt(view, 5 * BOXED_COOLDOWN_TICKS);
    expect(boxedGate(view, 6 * BOXED_COOLDOWN_TICKS)).toBe('cap');
    expect(idleStuckReflex.check(at(view, 6 * BOXED_COOLDOWN_TICKS))).toBeNull();
    expect(idleStuckReflex.check(at(view, 6 * BOXED_COOLDOWN_TICKS + 1))).toBeNull();
    const capLines = logs.mock.calls.filter(([line]) => String(line).includes('cap reached'));
    expect(capLines).toHaveLength(1);
    expect(noteCapLogged(view)).toBe(false);
  });

  it('refuses the seventh attempt inside the cooldown too, and the cooldown holds before the sixth', () => {
    const view = bodyIn(pocketWorld());
    for (let attempt = 0; attempt < 5; attempt++)
      noteBoxedAttempt(view, attempt * BOXED_COOLDOWN_TICKS);
    // Between the fifth and a sixth attempt the cooldown refuses; at 5 min it is open.
    expect(boxedGate(view, 4 * BOXED_COOLDOWN_TICKS + 1)).toBe('cooldown');
    expect(boxedGate(view, 5 * BOXED_COOLDOWN_TICKS)).toBe('ok');
    noteBoxedAttempt(view, 5 * BOXED_COOLDOWN_TICKS);
    expect(boxedGate(view, 5 * BOXED_COOLDOWN_TICKS + 1)).toBe('cooldown');
    expect(boxedGate(view, 6 * BOXED_COOLDOWN_TICKS)).toBe('cap');
  });

  it('a cap line is written again only after a window frees a slot', () => {
    const view = bodyIn(pocketWorld());
    for (let attempt = 0; attempt < 6; attempt++)
      noteBoxedAttempt(view, attempt * BOXED_COOLDOWN_TICKS);
    expect(boxedGate(view, 6 * BOXED_COOLDOWN_TICKS)).toBe('cap');
    expect(noteCapLogged(view)).toBe(true);
    // The first attempt (tick 0) leaves the hour at 72000; the cooldown ended long before.
    expect(boxedGate(view, 72000)).toBe('ok');
    expect(noteCapLogged(view)).toBe(true);
  });
});

describe('idle_stuck boxed-in dig guard, per step (decision 0336)', () => {
  it('refuses a dig step when lava is revealed by the step before it', async () => {
    const world = pocketWorld();
    const view = bodyIn(world);
    const bot = digBot(world);
    const signal = new AbortController().signal;
    const logs = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => undefined);
    setDigGuard(bot, boxedDigGuard(view));
    try {
      const first = new Vec3(2, 64, 0);
      expect(
        await dig(bot, signal, { name: 'stone', position: first } as never, SPOT as never),
      ).toBe(true);
      // The first dig opens lava one cell past the wall: the next step, beside it, is refused.
      world.fill(new Vec3(3, 64, 0), new Vec3(3, 64, 0), 'lava');
      const second = new Vec3(2, 64, 1);
      expect(
        await dig(bot, signal, { name: 'stone', position: second } as never, SPOT as never),
      ).toBe(false);
      expect(bot.dig).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls.some(([line]) => String(line).includes('dig refused'))).toBe(true);
    } finally {
      setDigGuard(bot, null);
    }
  });

  it('without a guard set, the same dig step runs', async () => {
    const world = pocketWorld();
    world.fill(new Vec3(3, 64, 0), new Vec3(3, 64, 0), 'lava');
    const bot = digBot(world);
    const block = { name: 'stone', position: new Vec3(2, 64, 1) } as never;
    expect(await dig(bot, new AbortController().signal, block, SPOT as never)).toBe(true);
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });
});
