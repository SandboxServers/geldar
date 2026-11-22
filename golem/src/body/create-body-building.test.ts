import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { BUILDING_REFUSAL } from '../building/names.ts';
import type { GolemMetrics } from '../metrics.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { createBody } from './create-body.ts';

const LIFE = 'ag_test_building';

/** A metrics object whose plan counters are spies; the Body is handed it as its GolemMetrics. */
function spyMetrics() {
  const spy = {
    planCell: vi.fn(),
    planSeconds: vi.fn(),
    planThrottleWait: vi.fn(),
    planQueueDepth: vi.fn(),
    seenFlush: vi.fn(),
  };
  return { spy, metrics: spy as unknown as GolemMetrics };
}

/** A body over fakes with the building flag set. The bot's world is air, and it holds stone. */
function buildingBody(opts: { building: boolean; bot?: Bot; metrics?: GolemMetrics }) {
  const ticks = manualTicks();
  const view = fakeView();
  const bot = opts.bot ?? fakeBot();
  // A fake wall clock: each world tick is 50 ms of wall time (20 TPS), however slow the test is.
  const wall = { ms: 0 };
  const made = createBody({
    lifeId: LIFE,
    bodyGeneration: 1,
    bot,
    ticks: ticks.source,
    currentRevision: () => 1,
    view,
    building: opts.building,
    wallClock: () => wall.ms,
    ...(opts.metrics === undefined ? {} : { metrics: opts.metrics }),
  });
  return { ...made, ticks, view, bot, wall };
}

/**
 * A bot whose cells are air and whose inventory holds stone (the cell preflight passes). Each read
 * of a cell advances the view's tick by one, as a cell's world ticks do, so a slice of the lane
 * ends after its `SLICE_TICKS` (4) rather than running the whole plan on one tick.
 */
function airWorld(bot: Bot, view: { tick: number }): void {
  const world = bot as unknown as {
    blockAt: () => { name: string };
    inventory: { items: () => { name: string; count: number }[] };
  };
  world.blockAt = () => {
    view.tick += 1;
    return { name: 'air' };
  };
  world.inventory = { items: () => [{ name: 'stone', count: 64 }] };
}

/** The view the test drives: the fake view's tick and fire flag are plain fields. */
function mutableView(made: { view: unknown }): { tick: number; onFire: boolean } {
  return made.view as { tick: number; onFire: boolean };
}

/** A plan of `n` stone cells in a row at y 64. */
function row(n: number, planId = 'p1') {
  return {
    do: 'plan',
    op: 'add',
    plan_id: planId,
    palette: { s: { block: 'stone' } },
    steps: Array.from({ length: n }, (_, i) => ({
      op: 'place',
      pal: 's',
      at: { x: i, y: 64, z: 5 },
    })),
  };
}

/** Lets the tick hook and the actions it started run to the end. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** One world tick: the view's tick moves to `age`, the source emits it, and the tick settles. */
async function tickAt(made: ReturnType<typeof buildingBody>, age: number): Promise<void> {
  made.wall.ms += 50;
  mutableView(made).tick = age;
  made.ticks.emit(age);
  await flush();
}

describe('the plan queue and lane on the Body (BLD-38b)', () => {
  it('with body_actions.building on, a submitted plan reaches the cell executor through the lane over several ticks', async () => {
    const made = buildingBody({ building: true });
    airWorld(made.bot, mutableView(made));
    const placed: unknown[] = [];
    made.runtime.actions.onFinished((action) => {
      if ((action as { do?: string }).do === 'place') placed.push(action);
    });
    made.runtime.start();
    const reply = await made.runtime.runAction(row(10));
    expect(reply.state).toBe('completed');
    expect(made.plan?.queue).toBeDefined();
    expect(made.plan?.lane.state).toBe('idle');
    await tickAt(made, 1);
    expect(placed.length).toBeGreaterThan(0);
    for (let age = 2; age <= 60 && placed.length < 10; age++) await tickAt(made, age);
    expect(placed.length).toBe(10);
    expect(made.plan?.lane.state).toBe('idle');
    await made.runtime.stop();
  }, 20_000);

  it('a palette state (stairs half top) reaches the place handler through the lane (BLD-fix5 F1)', async () => {
    const made = buildingBody({ building: true });
    airWorld(made.bot, mutableView(made));
    // The cell preflight needs the stairs in hand; airWorld holds stone only.
    const held = made.bot as unknown as {
      inventory: { items: () => { name: string; count: number }[] };
    };
    held.inventory = { items: () => [{ name: 'oak_stairs', count: 64 }] };
    const spy = vi.spyOn(made.runtime, 'runAction');
    made.runtime.start();
    const reply = await made.runtime.runAction({
      do: 'plan',
      op: 'add',
      plan_id: 'p1',
      palette: { s: { block: 'oak_stairs', state: { half: 'top' } } },
      steps: [{ op: 'place', pal: 's', at: { x: 0, y: 64, z: 5 } }],
    });
    expect(reply.state).toBe('completed');
    const places = () =>
      spy.mock.calls.filter((call) => (call[0] as { do?: string } | undefined)?.do === 'place');
    for (let age = 1; age <= 10 && places().length === 0; age++) await tickAt(made, age);
    expect(places()).toHaveLength(1);
    expect(places()[0]?.[2]).toEqual({ placeState: { half: 'top' } });
    await made.runtime.stop();
  }, 20_000);

  it('a reflex tick pauses the lane, and the lane resumes on the next tick without one', async () => {
    const made = buildingBody({ building: true });
    airWorld(made.bot, mutableView(made));
    made.runtime.start();
    await made.runtime.runAction(row(40));
    await tickAt(made, 1);
    const before = made.plan?.lane.checkpointState()?.cursor ?? 0;
    expect(before).toBeGreaterThan(0);
    // Fire fire-escape style hazard: the lane must hold while the reflex runs.
    mutableView(made).onFire = true;
    await tickAt(made, 30);
    expect(made.plan?.lane.state).toBe('paused');
    mutableView(made).onFire = false;
    await tickAt(made, 60);
    expect(made.plan?.lane.state).toBe('running');
    await made.runtime.stop();
  });

  it('death clears the plan queue: the lane is idle and no cell runs after it', async () => {
    const made = buildingBody({ building: true });
    airWorld(made.bot, mutableView(made));
    const placed: unknown[] = [];
    made.runtime.actions.onFinished((action) => {
      if ((action as { do?: string }).do === 'place') placed.push(action);
    });
    made.runtime.start();
    await made.runtime.runAction(row(40));
    await tickAt(made, 1);
    expect(made.plan?.lane.state).toBe('running');
    const beforeDeath = placed.length;
    made.bot.emit('death');
    await flush();
    expect(made.plan?.lane.state).toBe('idle');
    expect(made.plan?.lane.checkpointState()).toBeNull();
    await tickAt(made, 20);
    expect(placed.length).toBe(beforeDeath);
    await made.runtime.stop();
  });

  it('with body_actions.building off nothing is constructed: no lane, no plan cells, plan refused', async () => {
    const made = buildingBody({ building: false });
    const blockAt = vi.fn(() => ({ name: 'air' }));
    (made.bot as unknown as { blockAt: typeof blockAt }).blockAt = blockAt;
    made.runtime.start();
    expect(made.plan).toBeNull();
    const reply = await made.runtime.runAction(row(3));
    expect(reply.state).toBe('failed');
    expect(reply.result.message).toBe(BUILDING_REFUSAL);
    await tickAt(made, 1);
    await tickAt(made, 2);
    expect(blockAt).not.toHaveBeenCalled();
    await made.runtime.stop();
  });
});

describe('createBody hands its metrics to the plan lane (BLD-38b)', () => {
  it('a plan cell is counted on the metrics the Body was given', async () => {
    const { spy, metrics } = spyMetrics();
    const made = buildingBody({ building: true, metrics });
    airWorld(made.bot, mutableView(made));
    made.runtime.start();
    await made.runtime.runAction(row(3));
    await tickAt(made, 1);
    expect(spy.planCell).toHaveBeenCalled();
    await made.runtime.stop();
  });

  it('with the flag off the lane is not built, so no plan metric is written', async () => {
    const { spy, metrics } = spyMetrics();
    const made = buildingBody({ building: false, metrics });
    made.runtime.start();
    await tickAt(made, 1);
    expect(spy.planCell).not.toHaveBeenCalled();
    await made.runtime.stop();
  });
});
