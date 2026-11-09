import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import {
  allReflexesOn,
  createBodyView,
  MemorySink,
  ReflexRunner,
  type TrackedBodyView,
} from '../../src/body/index.ts';
import { reportBlocked } from '../../src/body/reflexes/blocked-path.ts';
import { shelterReflexes } from '../../src/body/reflexes/shelter.ts';
import { type LiveContext, withLiveBot } from './fixture.ts';

/**
 * The shelter reflexes on 26.1. The burrow case runs in slot 3 (GolemPlace), the path cases in
 * slot 1 (GolemMove), the same slots the place and goto live files use. Written for the wave-end
 * live run; the bench arena geometry of `blocked-path` is reused (wall 5 ahead, goal 10 ahead).
 */
const BURROW_BOT = 'GolemPlace';
const BURROW_SLOT = 3;
const PATH_BOT = 'GolemMove';
const PATH_SLOT = 1;
/** Ticks to let the runner and the world settle. */
const SETTLE_TICKS = 40;
/** The gap of the detour wall, in z blocks from the arena center (the bench's `GAP_DZ`). */
const GAP_DZ = 12;

/** A runner over the shelter reflexes with the real registry, bot and view. */
function runnerFor(ctx: LiveContext, view: TrackedBodyView, sink: MemorySink): ReflexRunner {
  const registry = createRegistry();
  return new ReflexRunner({
    reflexes: shelterReflexes,
    config: allReflexesOn(),
    view,
    sink,
    lifeId: 'ag_live_shelter',
    bodyGeneration: 1,
    context: (now) => {
      return {
        bot: ctx.bot,
        view,
        registry,
        sink,
        lifeId: 'ag_live_shelter',
        bodyGeneration: 1,
        tick: now,
        signal: new AbortController().signal,
        cancelAction: async () => undefined,
      };
    },
  });
}

/** The 3x3x3 of blocks around the bot as ascii layers (feet level first), for a failure message. */
function surroundings(bot: LiveContext['bot']): string {
  const feet = bot.entity.position.floored();
  const layers: string[] = [];
  for (const dy of [-1, 0, 1]) {
    const rows: string[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      const row: string[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        row.push(bot.blockAt(feet.offset(dx, dy, dz))?.name ?? '?');
      }
      rows.push(row.join(' '));
    }
    layers.push(`y${dy >= 0 ? '+' : ''}${dy}: ${rows.join(' | ')}`);
  }
  return layers.join('\n');
}

describe('panic burrow on 26.1', () => {
  it('seals the bot in at night with no bed and no shelter', async () => {
    await withLiveBot({ name: BURROW_BOT, slot: BURROW_SLOT }, async (ctx) => {
      const { bot, ctl, arena } = ctx;
      const { x: cx, y: cy, z: cz } = arena.center;
      // A dirt bank beside the bot is the wall the pocket is dug into.
      await ctl.fill({ x: cx + 1, y: cy, z: cz - 3 }, { x: cx + 5, y: cy + 3, z: cz + 3 }, 'dirt');
      await ctl.give(BURROW_BOT, 'dirt', 4);
      await ctl.timeSet('midnight');
      await bot.waitForTicks(SETTLE_TICKS);

      const view = createBodyView(bot);
      const sink = new MemorySink();
      try {
        expect(view.isNight).toBe(true);
        expect(view.bedNearby).toBe(false);
        expect(view.enclosed).toBe(false);
        await runnerFor(ctx, view, sink).onTick(bot.time.age);

        expect(sink.reflexes.map((r) => r.name)).toEqual(['panic_burrow']);
        const outcome = sink.reflexes[0]?.outcome;
        const p = bot.entity.position;
        const why = `burrow outcome ${JSON.stringify(outcome)} at ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`;
        expect(outcome?.result, `${why}\n${surroundings(bot)}`).toBe('handled');
        await bot.waitForTicks(SETTLE_TICKS);
        expect(view.enclosed).toBe(true);
      } finally {
        view.dispose();
      }
    });
  }, 180_000);

  it('refuses on open ground', async () => {
    await withLiveBot({ name: BURROW_BOT, slot: BURROW_SLOT }, async (ctx) => {
      await ctx.ctl.timeSet('midnight');
      await ctx.bot.waitForTicks(SETTLE_TICKS);
      const view = createBodyView(ctx.bot);
      const sink = new MemorySink();
      try {
        await runnerFor(ctx, view, sink).onTick(ctx.bot.time.age);
        expect(sink.reflexes[0]).toMatchObject({
          name: 'panic_burrow',
          outcome: { result: 'abandoned', detail: 'no suitable block' },
        });
        expect(view.enclosed).toBe(false);
      } finally {
        view.dispose();
      }
    });
  }, 180_000);
});

describe('blocked path on 26.1', () => {
  it('ends blocked for a sealed target and raises the wake', async () => {
    await withLiveBot({ name: PATH_BOT, slot: PATH_SLOT }, async (ctx) => {
      const { bot, ctl, arena } = ctx;
      const { x: cx, y: cy } = arena.center;
      await ctl.fill(
        { x: cx + 5, y: cy, z: arena.min.z },
        { x: cx + 5, y: cy + 3, z: arena.max.z },
        'stone',
      );
      const goal = { x: cx + 10, y: cy, z: arena.center.z };
      const run = await runAction(createRegistry(), bot, { do: 'goto', target: goal });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'blocked' });

      const view = createBodyView(bot);
      const sink = new MemorySink();
      try {
        reportBlocked(view, { goal, range: 1, intentId: 'int_live' });
        await runnerFor(ctx, view, sink).onTick(bot.time.age);
        expect(sink.reflexes[0]).toMatchObject({
          name: 'blocked_path',
          outcome: { result: 'abandoned' },
        });
        expect(sink.wakes).toHaveLength(1);
        expect(sink.wakes[0]).toMatchObject({ reason: 'action_failed', intentId: 'int_live' });
        expect(sink.wakes[0]?.detail).toContain('blocked');
      } finally {
        view.dispose();
      }
    });
  }, 240_000);

  it('reaches a target behind a wall with a gap', async () => {
    await withLiveBot({ name: PATH_BOT, slot: PATH_SLOT }, async (ctx) => {
      const { bot, ctl, arena } = ctx;
      const { x: cx, y: cy, z: cz } = arena.center;
      const wall = (from: number, to: number) =>
        ctl.fill({ x: cx + 5, y: cy, z: cz + from }, { x: cx + 5, y: cy + 3, z: cz + to }, 'stone');
      await wall(arena.min.z - cz, GAP_DZ - 1);
      await wall(GAP_DZ + 1, arena.max.z - cz);
      const goal = { x: cx + 10, y: cy, z: cz };

      const view = createBodyView(bot);
      const sink = new MemorySink();
      try {
        // As if the walk had stalled on the wall: the reflex finds the way through the gap.
        reportBlocked(view, { goal, range: 1, intentId: 'int_live' });
        await runnerFor(ctx, view, sink).onTick(bot.time.age);
        expect(sink.reflexes[0]).toMatchObject({
          name: 'blocked_path',
          outcome: { result: 'handled' },
        });
        const at = bot.entity.position;
        expect(Math.hypot(at.x - (goal.x + 0.5), at.z - (goal.z + 0.5))).toBeLessThanOrEqual(4);
        expect(sink.wakes).toEqual([]);
      } finally {
        view.dispose();
      }
    });
  }, 240_000);
});
