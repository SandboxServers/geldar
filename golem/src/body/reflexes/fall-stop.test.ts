import { describe, expect, it } from 'vitest';
import { createBodyView } from '../view.ts';
import { basicContext, basicView, floor, gridBot } from './basic.fakes.ts';
import { createFallStopReflex, FALL_STOP_DROP } from './fall-stop.ts';

describe('fall-stop: check', () => {
  const reflex = createFallStopReflex();

  it('fires for a drop deeper than 4 blocks, not for 4', () => {
    const { view, state } = basicView({ drop: FALL_STOP_DROP });
    expect(reflex.check(view)).toBeNull();
    state.drop = FALL_STOP_DROP + 1;
    expect(reflex.check(view)).toEqual({ drop: 5 });
  });

  it('does not fire once the Body is already falling', () => {
    const { view } = basicView({ drop: 10, fallingDistance: 6 });
    expect(reflex.check(view)).toBeNull();
  });
});

describe('fall-stop: run', () => {
  it('cancels the action, stops the pathfinder and releases every movement key', async () => {
    const { view } = basicView({ drop: 10 });
    const stub = gridBot({});
    const { ctx, cancels } = basicContext(view, stub.bot);
    const outcome = await createFallStopReflex().run({ drop: 10 }, ctx);
    expect(outcome.result).toBe('handled');
    expect(cancels()).toBe(1);
    expect(stub.pathCalls).toEqual(['stop', 'setGoal']);
    expect(stub.controls).toEqual([
      'forward=false',
      'back=false',
      'left=false',
      'right=false',
      'sprint=false',
      'jump=false',
    ]);
  });

  it('reports failed when the Body keeps moving', async () => {
    const { view } = basicView({ drop: 10 });
    const stub = gridBot({});
    stub.velocity.x = 0.2;
    const { ctx } = basicContext(view, stub.bot);
    const outcome = await createFallStopReflex().run({ drop: 10 }, ctx);
    expect(outcome.result).toBe('failed');
  });
});

describe('BodyView.dropAhead', () => {
  /** Ground at y 63 for x up to 5; beyond x 5 open air down to the stone at `bottomY`. */
  function edge(bottomY: number) {
    const grid = floor({}, 63, -10, 5);
    for (let x = 6; x <= 10; x++)
      for (let z = -10; z <= 10; z++) grid[`${x},${bottomY},${z}`] = 'stone';
    const stub = gridBot(grid);
    (stub.bot.entity.position as { x: number }).x = 5.5;
    stub.velocity.x = 0.2;
    return { stub, view: createBodyView(stub.bot) };
  }

  it('measures the drop beyond an edge in the direction of motion', () => {
    const { view } = edge(53);
    // Cells 63 down to 54 are open: 10 blocks.
    expect(view.dropAhead()).toBe(10);
  });

  it('is 0 when standing still, over a flat floor, or when the drop ends in water', () => {
    const { stub, view } = edge(53);
    stub.velocity.x = 0;
    expect(view.dropAhead()).toBe(0);
    stub.velocity.x = 0.2;
    (stub.bot.entity.position as { x: number }).x = 2.5;
    expect(view.dropAhead()).toBe(0);
    (stub.bot.entity.position as { x: number }).x = 5.5;
    const grid = floor({}, 63, -10, 5);
    grid['6,58,0'] = 'water';
    const wet = gridBot(grid);
    (wet.bot.entity.position as { x: number }).x = 5.5;
    wet.velocity.x = 0.2;
    expect(createBodyView(wet.bot).dropAhead()).toBe(0);
  });

  it('does not count a wall ahead as a drop', () => {
    const { stub, view } = edge(53);
    (stub.bot.entity.position as { x: number }).x = 5.5;
    const grid = floor({}, 63, -10, 5);
    grid['6,64,0'] = 'stone';
    const walled = gridBot(grid);
    (walled.bot.entity.position as { x: number }).x = 5.5;
    walled.velocity.x = 0.2;
    expect(createBodyView(walled.bot).dropAhead()).toBe(0);
    expect(view.dropAhead()).toBe(10);
  });
});
