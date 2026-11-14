import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOSS_PITCH, tossPitch } from './give.ts';
import { setup } from './give-test-fixture.ts';
import { moveNear } from './pathing.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
const walk = vi.mocked(moveNear);

beforeEach(() => walk.mockReset());

describe('give', () => {
  it('tosses the items toward a visible agent within reach', async () => {
    const { world, run, toss, lookAt } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const out = await run('Pike');
    expect(out).toEqual({
      status: 'completed',
      detail: { to: 'Pike', item: 'oak_log', count: 3 },
    });
    expect(walk).not.toHaveBeenCalled();
    expect(lookAt).toHaveBeenCalled();
    expect(toss).toHaveBeenCalledWith(42, null, 3);
  });

  it('aims at the recipient about 0.9 of its height up, not at its feet', async () => {
    const { world, run, lookAt } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 64, 2.5),
      height: 1.8,
    };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    const aim = lookAt.mock.calls[0]?.[0] as Vec3;
    expect(aim.x).toBeCloseTo(0.5, 6);
    expect(aim.y).toBeCloseTo(64 + 1.8 * 0.9, 6);
    expect(aim.z).toBeCloseTo(2.5, 6);
  });

  it('looks 30 degrees down, turned to the recipient, before it tosses', async () => {
    const { world, run, look } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(2.5, 64, 2.5) };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    const sent = look.mock.calls[0] as unknown as [number, number, boolean];
    // The Body is at (0.5, 0.5) and Pike at (2.5, 2.5): yaw is atan2(-dx, -dz), as mineflayer uses.
    expect(sent[0]).toBeCloseTo(Math.atan2(-2, -2), 6);
    expect(sent[1]).toBe(TOSS_PITCH);
    expect(sent[1]).toBeLessThan(0);
    expect(sent[2]).toBe(true);
  });

  it('looks up at the pitch tossPitch gives when the recipient is one block up', async () => {
    const { world, run, look } = setup();
    // The Body is at (0.5, 64, 0.5) and Pike at (2.5, 65, 1.5): one block up, 2.24 blocks out.
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(2.5, 65, 1.5) };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    const sent = look.mock.calls[0] as unknown as [number, number, boolean];
    expect(sent[1]).toBeCloseTo(tossPitch(1, Math.hypot(2, 1)), 12);
    expect(sent[1]).toBeGreaterThan(0);
  });

  it('waits at least two ticks for the look to reach the server, then tosses', async () => {
    const { world, run, order, waitForTicks } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(order).toEqual(['lookAt', 'look', 'waitForTicks', 'toss']);
    expect(waitForTicks.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(2);
  });

  it('tosses nothing when the run aborts during the wait for the look', async () => {
    const { world, run, toss, waitForTicks, controller } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    waitForTicks.mockImplementationOnce(async () => {
      controller.abort();
    });
    expect(await run('Pike')).toEqual({ status: 'cancelled', detail: {} });
    expect(toss).not.toHaveBeenCalled();
  });

  it('fails not_possible and tosses nothing to a recipient 1.5 blocks up and over 2 out', async () => {
    const { world, run, toss } = setup();
    // The Body is at (0.5, 64, 0.5); Pike is 1.5 blocks up and 2.4 out, 2.83 blocks away.
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 65.5, 2.9),
      height: 1.8,
    };
    expect(await run('Pike')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'too far up to toss to',
    });
    expect(toss).not.toHaveBeenCalled();
  });

  it('still tosses to a recipient 1.5 blocks up and exactly 2 out', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 65.5, 2.5),
      height: 1.8,
    };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(toss).toHaveBeenCalledOnce();
  });

  it('fails blocked and tosses nothing when glass is between the Body and the recipient', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 64, 2.5),
      height: 1.8,
    };
    // The eyes are at (0.5, 65.62, 0.5); the ray to Pike's middle crosses block (0, 65, 1).
    world.set('glass_pane', 0, 65, 1);
    expect(await run('Pike')).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'something is in the way of the toss',
    });
    expect(toss).not.toHaveBeenCalled();
  });
});

describe('tossPitch', () => {
  const degrees = (deg: number) => (deg * Math.PI) / 180;

  it('looks 30 degrees down when the recipient is level with the Body or below it', () => {
    expect(tossPitch(0, 2)).toBe(TOSS_PITCH);
    expect(tossPitch(-1, 2)).toBe(TOSS_PITCH);
    expect(tossPitch(0, 1.75)).toBe(TOSS_PITCH);
  });

  it('looks 40 degrees down when the recipient is level or below and under 1.75 blocks out', () => {
    expect(tossPitch(-1, 1.5)).toBeCloseTo(degrees(-40), 12);
    expect(tossPitch(0, 1.5)).toBeCloseTo(degrees(-40), 12);
    expect(tossPitch(0, 1.74)).toBeCloseTo(degrees(-40), 12);
  });

  it('looks up at one block up, flatter as the recipient is farther out', () => {
    expect(tossPitch(1, 1.5)).toBeCloseTo(degrees(65), 12);
    expect(tossPitch(1, 2)).toBeCloseTo(degrees(175 / 3), 12);
    expect(tossPitch(1, 3)).toBeCloseTo(degrees(45), 12);
  });

  it('keeps the high pitch for a recipient two blocks up', () => {
    expect(tossPitch(2, 2)).toBeCloseTo(degrees(60), 12);
    expect(tossPitch(2, 3)).toBeCloseTo(degrees(50), 12);
  });
});
describe('give: stepping back, the pickup delay, and taking the items back', () => {
  /** A walk that moves the Body to `spot` and reports it arrived. */
  const walkTo = (world: { me: { position: Vec3 } }, spot: Vec3) =>
    vi.fn(async () => {
      world.me.position = spot;
      return { ok: true, distance: 2 } as never;
    });

  it('steps back to about 2 blocks before tossing when the recipient is 0.1 blocks away', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockImplementation(walkTo(world, new Vec3(-1.5, 64, 0.5)) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk).toHaveBeenCalledOnce();
    const spot = walk.mock.calls[0]?.[1] as Vec3;
    expect(spot.x).toBeCloseTo(-1.5, 6);
    expect(spot.z).toBeCloseTo(0.5, 6);
    expect(spot.distanceTo(new Vec3(0.6, 64, 0.5))).toBeCloseTo(2.1, 6);
    expect(walk.mock.calls[0]?.[2]).toBe(0.5);
    expect(walk.mock.invocationCallOrder[0]).toBeLessThan(toss.mock.invocationCallOrder[0] ?? 0);
  });

  it('does not step back from a recipient 1.5 blocks or further away', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(2, 64, 0.5) };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk).not.toHaveBeenCalled();
    expect(toss).toHaveBeenCalledOnce();
  });

  it('fails not_possible and tosses nothing when there is no room to step back', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' } as never);
    expect(await run('Pike')).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'too close to toss, and no room to step back',
      detail: {},
    });
    expect(toss).not.toHaveBeenCalled();
  });

  it('fails not_possible and tosses nothing when the recipient is 1.0 blocks away and the step back fails', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(1, 64, 0) };
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' } as never);
    expect(await run('Pike')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'too close to toss, and no room to step back',
    });
    // Six standable blocks lie 1.5 to 3 blocks from the recipient, one per distinct cell.
    expect(walk).toHaveBeenCalledTimes(6);
    expect(toss).not.toHaveBeenCalled();
  });

  it('walks to the next standable block when the straight-back walk fails, then tosses', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk
      .mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'no path' } as never)
      .mockImplementationOnce(async (_bot, spot) => {
        world.me.position = spot as Vec3;
        return { ok: true, distance: 2 } as never;
      });
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk).toHaveBeenCalledTimes(2);
    // The straight-back block is the cell at x -2, its centre 2.1 from the recipient; the next is 45 degrees.
    expect(walk.mock.calls[0]?.[1]).toEqual(new Vec3(-1.5, 64, 0.5));
    expect(walk.mock.calls[1]?.[1]).toEqual(new Vec3(-1.5, 64, -1.5));
    expect(toss).toHaveBeenCalledOnce();
  });

  it('refuses not_possible when all five spots are blocked, and tries each one', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' } as never);
    expect(await run('Pike')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'too close to toss, and no room to step back',
    });
    expect(walk).toHaveBeenCalledTimes(5);
    expect(world.me.position).toEqual(new Vec3(0.5, 64, 0.5));
    expect(toss).not.toHaveBeenCalled();
  });

  it('is cancelled, and walks no further, when the run aborts between the tries', async () => {
    const { world, run, toss, controller } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk
      .mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'no path' } as never)
      .mockImplementationOnce(async () => {
        controller.abort();
        return { ok: false, reason: 'cancelled', message: 'stopped' } as never;
      });
    expect(await run('Pike')).toEqual({ status: 'cancelled', detail: {} });
    expect(walk).toHaveBeenCalledTimes(2);
    expect(world.me.position).toEqual(new Vec3(0.5, 64, 0.5));
    expect(toss).not.toHaveBeenCalled();
  });

  it('is cancelled, and does not toss, when the run aborts during the step back', async () => {
    const { world, run, toss, controller } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockImplementation(async () => {
      controller.abort();
      return { ok: false, reason: 'cancelled', message: 'stopped' } as never;
    });
    expect(await run('Pike')).toEqual({ status: 'cancelled', detail: {} });
    expect(toss).not.toHaveBeenCalled();
  });
});

describe('give: step-back candidates are standable blocks', () => {
  /** A walk that moves the Body to whatever block it is sent to, and reports it arrived. */
  const arrive = (world: { me: { position: Vec3 } }) => async (_bot: unknown, spot: unknown) => {
    world.me.position = spot as Vec3;
    return { ok: true, distance: 1 } as never;
  };

  it('tries the next block when a walk reports ok but the Body does not move', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk
      .mockResolvedValueOnce({ ok: true, distance: 0 } as never)
      .mockImplementationOnce(arrive(world) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk).toHaveBeenCalledTimes(2);
    expect(walk.mock.calls[1]?.[1]).toEqual(new Vec3(-1.5, 64, -1.5));
    expect(toss).toHaveBeenCalledOnce();
  });

  it('skips the spot that falls in the Body own block', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7] });
    world.me.position = new Vec3(0.9, 64, 0.5);
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(2.2, 64, 0.5) };
    walk.mockImplementation(arrive(world) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    // The straight-back spot (0.2, 0.5) is in the Body's cell, so the first walk goes to x -1.
    expect(walk.mock.calls[0]?.[1]).toEqual(new Vec3(-0.5, 64, 0.5));
    expect(walk).toHaveBeenCalledOnce();
  });

  it('skips a block whose feet cell is solid', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    world.set('stone', -2, 64, 0);
    walk.mockImplementation(arrive(world) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk.mock.calls[0]?.[1]).toEqual(new Vec3(-1.5, 64, -1.5));
    expect(walk.mock.calls.map((call) => call[1])).not.toContainEqual(new Vec3(-1.5, 64, 0.5));
  });

  it('skips a block whose floor is air', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    world.clear(-2, 63, 0);
    walk.mockImplementation(arrive(world) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk.mock.calls[0]?.[1]).toEqual(new Vec3(-1.5, 64, -1.5));
    expect(walk.mock.calls.map((call) => call[1])).not.toContainEqual(new Vec3(-1.5, 64, 0.5));
  });

  it('walks to a step-back block with digging off', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockImplementation(arrive(world) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ digTier: false });
  });

  it('logs one give_stepback_failed line with the tries and the gap when every block fails', async () => {
    const { world, run, toss } = setup(5, { dropped: [7], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.6, 64, 0.5) };
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' } as never);
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    expect(await run('Pike')).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'too close to toss, and no room to step back',
      detail: {},
    });
    expect(toss).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: 'give_stepback_failed',
      tried: 5,
      gap: 0.1,
    });
    log.mockRestore();
  });
});
