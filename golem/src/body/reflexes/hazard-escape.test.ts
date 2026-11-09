import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { basicContext, basicView, floor, gridBot, gridReader } from './basic.fakes.ts';
import {
  createHazardEscapeReflex,
  DROWNING_AIR,
  type EscapeMover,
  findSafeBlock,
  steerBlocked,
} from './hazard-escape.ts';

describe('hazard-escape: check', () => {
  const reflex = createHazardEscapeReflex();

  it('fires in lava, drowning, and burning on land', () => {
    const { view, state } = basicView();
    expect(reflex.check(view)).toBeNull();
    state.inFluid = 'lava';
    expect(reflex.check(view)).toEqual({ hazard: 'lava' });
    state.inFluid = 'water';
    expect(reflex.check(view)).toBeNull();
    state.air = DROWNING_AIR;
    expect(reflex.check(view)).toEqual({ hazard: 'drowning', air: DROWNING_AIR });
    state.inFluid = null;
    state.air = 20;
    state.onFire = true;
    expect(reflex.check(view)).toEqual({ hazard: 'fire' });
  });

  it('does not fire for a burning Body that is in water with air', () => {
    const { view } = basicView({ onFire: true, inFluid: 'water', air: 20 });
    expect(reflex.check(view)).toBeNull();
  });
});

describe('findSafeBlock', () => {
  it('picks the nearest dry stand beside a lava pool', () => {
    // Ground at y 63 everywhere, lava replaces the floor-level cells of x -2..2 (a pool 1 deep).
    const grid = floor({}, 63, -10, 10);
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) grid[`${x},63,${z}`] = 'lava';
    }
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) grid[`${x},64,${z}`] = 'lava';
    const found = findSafeBlock(gridReader(grid), { x: 0, y: 64, z: 0 });
    expect(found).not.toBeNull();
    expect(Math.max(Math.abs(found?.x ?? 0), Math.abs(found?.z ?? 0))).toBe(3);
    expect(found?.y).toBe(64);
  });

  it('never picks water over a drop, nor a stand on magma', () => {
    // Water at y 64 above air at y 63 (a drop), and a magma floor ring: nothing is safe.
    const grid = floor({}, 62, -10, 10);
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) grid[`${x},64,${z}`] = 'water';
    }
    expect(findSafeBlock(gridReader(grid), { x: 0, y: 64, z: 0 })).toBeNull();
    const magma = floor({}, 63, -10, 10);
    for (const key of Object.keys(magma)) magma[key] = 'magma_block';
    expect(findSafeBlock(gridReader(magma), { x: 0, y: 64, z: 0 })).toBeNull();
  });

  it('needs head room', () => {
    const grid = floor({}, 63, -2, 2);
    // A solid slab from y 65 up past the scan height: no cell has two open blocks above a floor.
    for (let y = 65; y <= 70; y++) {
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) grid[`${x},${y},${z}`] = 'stone';
    }
    expect(findSafeBlock(gridReader(grid), { x: 0, y: 64, z: 0 })).toBeNull();
  });
});

describe('hazard-escape: run', () => {
  /** A pool of lava at the origin with ground around it; the Body stands in it. */
  function pool() {
    const grid = floor({}, 63, -10, 10);
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        grid[`${x},63,${z}`] = 'lava';
        grid[`${x},64,${z}`] = 'lava';
      }
    }
    const { view, state } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 } });
    return { grid, view, state, bot: gridBot(grid).bot };
  }

  it('walks to the nearest safe block and reports handled', async () => {
    const { view, state, bot } = pool();
    const { ctx, cancels } = basicContext(view, bot);
    const seen: Array<{ x: number; y: number; z: number }> = [];
    const mover: EscapeMover = async (walk) => {
      seen.push(walk.target);
      state.position = walk.target;
      state.inFluid = null;
    };
    const outcome = await createHazardEscapeReflex({ mover }).run({ hazard: 'lava' }, ctx);
    expect(outcome).toEqual({ result: 'handled', detail: 'left lava' });
    expect(cancels()).toBe(1);
    expect(seen).toHaveLength(1);
    expect(Math.max(Math.abs(seen[0]?.x ?? 0), Math.abs(seen[0]?.z ?? 0))).toBe(2);
  });

  it('gives up after the time limit with a danger wake', async () => {
    const { view, state, bot } = pool();
    const { ctx, sink } = basicContext(view, bot);
    const mover: EscapeMover = async (walk) => {
      state.tick += 40;
      expect(walk.expired()).toBe(false);
      state.tick += 200;
      expect(walk.expired()).toBe(true);
    };
    const outcome = await createHazardEscapeReflex({ mover, limitTicks: 200 }).run(
      { hazard: 'lava' },
      ctx,
    );
    expect(outcome.result).toBe('abandoned');
    expect(outcome.detail).toContain('200 ticks');
    expect(sink.wakes).toEqual([
      { reason: 'reflex_danger', tick: 100, intentId: null, detail: outcome.detail },
    ]);
  });

  it('gives up at once with a danger wake when no safe block is near', async () => {
    const grid: Record<string, string> = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) grid[`${x},64,${z}`] = 'lava';
    const { view } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 } });
    const { ctx, sink, cancels } = basicContext(view, gridBot(grid).bot);
    let moved = false;
    const mover: EscapeMover = async () => {
      moved = true;
    };
    const outcome = await createHazardEscapeReflex({ mover }).run({ hazard: 'lava' }, ctx);
    expect(outcome.result).toBe('abandoned');
    expect(moved).toBe(false);
    // Nothing to try, so the running action is left alone.
    expect(cancels()).toBe(0);
    expect(sink.wakes).toHaveLength(1);
  });

  it('leaves a burning Body alone when it is not in a hazard block', async () => {
    const grid = floor({}, 63, -3, 3);
    const { view } = basicView({ onFire: true, position: { x: 0, y: 64, z: 0 } });
    const { ctx, sink, cancels } = basicContext(view, gridBot(grid).bot);
    const outcome = await createHazardEscapeReflex().run({ hazard: 'fire' }, ctx);
    expect(outcome.result).toBe('abandoned');
    expect(cancels()).toBe(0);
    expect(sink.wakes).toHaveLength(0);
  });

  it('swims up when drowning and no stand block is in range', async () => {
    const grid: Record<string, string> = {};
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) {
        for (let y = 60; y <= 66; y++) grid[`${x},${y},${z}`] = 'water';
      }
    }
    const { view, state } = basicView({
      inFluid: 'water',
      air: 2,
      position: { x: 0, y: 64, z: 0 },
    });
    const { ctx, cancels } = basicContext(view, gridBot(grid).bot);
    let swam = false;
    let walked = false;
    const swimmer: EscapeMover = async () => {
      swam = true;
      state.air = 20;
    };
    const mover: EscapeMover = async () => {
      walked = true;
    };
    const outcome = await createHazardEscapeReflex({ mover, swimmer }).run(
      { hazard: 'drowning', air: 2 },
      ctx,
    );
    expect(outcome).toEqual({ result: 'handled', detail: 'left drowning' });
    expect(swam).toBe(true);
    expect(walked).toBe(false);
    expect(cancels()).toBe(1);
  });

  it('does not swim up for lava with no safe block: it gives up', async () => {
    const grid: Record<string, string> = {};
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) grid[`${x},64,${z}`] = 'lava';
    const { view } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 } });
    const { ctx } = basicContext(view, gridBot(grid).bot);
    let swam = false;
    const swimmer: EscapeMover = async () => {
      swam = true;
    };
    const outcome = await createHazardEscapeReflex({ swimmer }).run({ hazard: 'lava' }, ctx);
    expect(outcome.result).toBe('abandoned');
    expect(swam).toBe(false);
  });
});

describe('hazard-escape: steering', () => {
  /** A bot at (0.5, 64, 0.5) over a grid, with the in-lava flag set as given. */
  function steerBot(grid: Record<string, string>, inLava: boolean) {
    const read = gridReader(grid);
    return {
      entity: { position: new Vec3(0.5, 64, 0.5), isInLava: inLava },
      blockAt: (at: Vec3) => read(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)),
    } as unknown as Bot;
  }
  const east = new Vec3(5.5, 64, 0.5);

  it('stops at a wall at head height', () => {
    expect(steerBlocked(steerBot({ '1,65,0': 'stone' }, false), east)).toBe(true);
    expect(steerBlocked(steerBot({}, false), east)).toBe(false);
  });

  it('stops at lava unless the Body is already in lava', () => {
    expect(steerBlocked(steerBot({ '1,64,0': 'lava' }, false), east)).toBe(true);
    expect(steerBlocked(steerBot({ '1,64,0': 'lava' }, true), east)).toBe(false);
  });
});
