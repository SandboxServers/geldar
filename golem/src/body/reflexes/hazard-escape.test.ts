import { describe, expect, it } from 'vitest';
import { basicContext, basicView, floor, gridBot, gridReader } from './basic.fakes.ts';
import {
  createHazardEscapeReflex,
  DROWNING_AIR,
  type EscapeMover,
  findSafeBlock,
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
    const { ctx, sink } = basicContext(view, gridBot(grid).bot);
    let moved = false;
    const mover: EscapeMover = async () => {
      moved = true;
    };
    const outcome = await createHazardEscapeReflex({ mover }).run({ hazard: 'lava' }, ctx);
    expect(outcome.result).toBe('abandoned');
    expect(moved).toBe(false);
    expect(sink.wakes).toHaveLength(1);
  });

  it('leaves a burning Body alone when it is not in a hazard block', async () => {
    const grid = floor({}, 63, -3, 3);
    const { view } = basicView({ onFire: true, position: { x: 0, y: 64, z: 0 } });
    const { ctx, sink } = basicContext(view, gridBot(grid).bot);
    const outcome = await createHazardEscapeReflex().run({ hazard: 'fire' }, ctx);
    expect(outcome.result).toBe('abandoned');
    expect(sink.wakes).toHaveLength(0);
  });
});
