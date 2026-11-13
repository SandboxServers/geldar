import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWorld } from '../perception/perception.fakes.ts';
import { giveAction, NOT_IN_SIGHT } from './give.ts';
import type { ActionOutcome } from './outcome.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
const walk = vi.mocked(moveNear);

/** What the server does after a toss: the item entities it drops, and who picks which one up. */
interface Pickups {
  dropped?: number[];
  picked?: number[];
  by?: string;
  abortOnToss?: boolean;
  /** When set, the pickups happen this many ms after the toss, as a real pickup delay does. */
  after?: number;
}

/**
 * A fake world with a Kestrel bot at the origin, 5 oak_log in the inventory, a toss spy, and an
 * event emitter. A toss spawns the `dropped` item entities and emits the `picked` pickups by
 * `by` (default Pike), both before it resolves, as the server does.
 */
function setup(held = 5, pickups: Pickups = {}) {
  const world = new FakeWorld();
  const events = new EventEmitter();
  const controller = new AbortController();
  const pike = { type: 'player', username: pickups.by ?? 'Pike', position: new Vec3(0.5, 64, 2.5) };
  const item = (id: number) => ({
    id,
    name: 'item',
    type: 'other',
    position: new Vec3(0.5, 64, 3.5),
  });
  const toss = vi.fn(async () => {
    for (const id of pickups.dropped ?? [7]) events.emit('entitySpawn', item(id));
    for (const id of pickups.picked ?? [7]) {
      if (pickups.after === undefined) events.emit('playerCollect', pike, item(id));
      else setTimeout(() => events.emit('playerCollect', pike, item(id)), pickups.after);
    }
    if (pickups.abortOnToss) controller.abort();
  });
  const lookAt = vi.fn(async (_at?: Vec3, _force?: boolean) => {});
  // The server's full player list: a player listed here is known to the server, not to the agent.
  const players: Record<string, unknown> = { Hidden: { entity: { position: new Vec3(0, 64, 5) } } };
  const bot = Object.assign(world.bot, {
    players,
    inventory: { items: () => [{ name: 'oak_log', count: held }] },
    registry: { items: {}, itemsByName: { oak_log: { id: 42 } } },
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
    emit: events.emit.bind(events),
    toss,
    lookAt,
  }) as Bot;
  const run = (to: string, count = 3, item = 'oak_log', timeScale = 1): Promise<ActionOutcome> =>
    giveAction.run(
      { bot, signal: controller.signal, timeScale },
      {
        do: 'give',
        to,
        item,
        count,
      },
    );
  return { world, run, toss, lookAt, events, controller };
}

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

  it('walks up to a visible agent that is further than 3 blocks, then tosses', async () => {
    const { world, run, toss } = setup();
    const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 8.5) };
    world.entities[2] = pike;
    walk.mockImplementation(async () => {
      world.me.position = new Vec3(0.5, 64, 6.5);
      return { ok: true, distance: 2 } as never;
    });
    const out = await run('Pike');
    expect(out.status).toBe('completed');
    expect(walk.mock.calls[0]?.[2]).toBe(2);
    expect(toss).toHaveBeenCalledOnce();
  });

  it('fails out_of_reach when the walk leaves the agent beyond 3 blocks', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 9.5) };
    walk.mockResolvedValue({ ok: true, distance: 6 } as never);
    expect(await run('Pike')).toMatchObject({ status: 'failed', reason: 'out_of_reach' });
    expect(toss).not.toHaveBeenCalled();
  });

  it('fails not_found when the agent walks out of sight during the approach', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 9.5) };
    walk.mockImplementation(async () => {
      world.set('stone', 0, 64, 5);
      world.set('stone', 0, 65, 5);
      return { ok: true, distance: 0 } as never;
    });
    expect(await run('Pike')).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(toss).not.toHaveBeenCalled();
  });

  it('fails not_possible when the item is not held in that quantity', async () => {
    const { world, run, toss } = setup(2);
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike', 3)).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(await run('Pike', 1, 'diamond')).toMatchObject({ reason: 'not_possible' });
    expect(toss).not.toHaveBeenCalled();
  });

  it('cannot see a player the server lists but the agent does not see (knowledge boundary)', async () => {
    const { run, toss } = setup();
    // `Hidden` is in bot.players (the server's list) but has no entity in view.
    const out = await run('Hidden');
    expect(out).toEqual({
      status: 'failed',
      reason: 'not_found',
      message: NOT_IN_SIGHT,
      detail: {},
    });
    expect(toss).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
  });

  it('gives the same refusal for a player behind a wall and for a name that does not exist', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.set('stone', 0, 64, 1);
    world.set('stone', 0, 65, 1);
    world.set('stone', 1, 64, 1);
    world.set('stone', 1, 65, 1);
    const walled = await run('Pike');
    const absent = await run('Nobody');
    expect(walled).toEqual(absent);
    expect(walled).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
    expect(toss).not.toHaveBeenCalled();
  });

  it('fails interrupted when the toss throws, and cancelled on abort', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    toss.mockRejectedValueOnce(new Error('toss failed'));
    expect(await run('Pike')).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });

  it('completes only when the recipient picks up every tossed item', async () => {
    const { world, run } = setup(5, { dropped: [7, 8], picked: [7, 8] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
  });

  it('fails not_possible with the ground message when the items are never picked up', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'the items are on the ground near Pike',
      detail: {},
    });
  });

  it('does not count a pickup by someone other than the recipient', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7], by: 'Other' });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    // Other is not in sight, so the text names no one.
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'someone else picked the items up',
    });
  });

  it('says the items went to a bystander in sight who collected every one, with no walk', async () => {
    const { world, run, toss } = setup(5, { dropped: [7, 8], picked: [7, 8], by: 'Other' });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.entities[3] = { type: 'player', username: 'Other', position: new Vec3(-1.5, 64, 2.5) };
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'the items went to Other',
      detail: {},
    });
    expect(walk).not.toHaveBeenCalled();
    expect(toss).toHaveBeenCalledOnce();
  });

  it('names no one when the bystander is out of sight, and says someone else picked them up', async () => {
    const { world, run } = setup(5, { dropped: [7, 8], picked: [7, 8], by: 'Other' });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const out = await run('Pike', 3, 'oak_log', 0.01);
    expect(out).toMatchObject({
      reason: 'not_possible',
      message: 'someone else picked the items up',
    });
    expect(JSON.stringify(out)).not.toContain('Other');
  });

  it('gives the combined text when the recipient got one item and a bystander in sight the other', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.entities[3] = { type: 'player', username: 'Other', position: new Vec3(-1.5, 64, 2.5) };
    const recipient = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const bystander = { type: 'player', username: 'Other', position: new Vec3(-1.5, 64, 2.5) };
    const item = (id: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
    });
    toss.mockImplementationOnce(async () => {
      events.emit('entitySpawn', item(7));
      events.emit('entitySpawn', item(8));
      events.emit('playerCollect', recipient, item(7));
      events.emit('playerCollect', bystander, item(8));
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: '1 of 2 were picked up; the rest went to Other',
      detail: {},
    });
  });

  it('names no one for a bystander out of sight in the combined text', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const recipient = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const bystander = { type: 'player', username: 'Other', position: new Vec3(-1.5, 64, 2.5) };
    const item = (id: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
    });
    toss.mockImplementationOnce(async () => {
      events.emit('entitySpawn', item(7));
      events.emit('entitySpawn', item(8));
      events.emit('playerCollect', recipient, item(7));
      events.emit('playerCollect', bystander, item(8));
    });
    const out = await run('Pike', 3, 'oak_log', 0.01);
    expect(out).toMatchObject({
      message: '1 of 2 were picked up; someone else picked up the rest',
    });
    expect(JSON.stringify(out)).not.toContain('Other');
  });

  it('takes back only the items no one else picked up, with one walk', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const bystander = { type: 'player', username: 'Other', position: new Vec3(-1.5, 64, 2.5) };
    const item = (id: number, z: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, z),
    });
    const gone = item(7, 3.5);
    const onGround = item(8, 4.5);
    world.entities[7] = gone;
    world.entities[8] = onGround;
    toss.mockImplementationOnce(async () => {
      events.emit('entitySpawn', gone);
      events.emit('entitySpawn', onGround);
      events.emit('playerCollect', bystander, gone);
    });
    walk.mockImplementation(async () => {
      events.emit('playerCollect', world.me, onGround);
      delete world.entities[8];
      return { ok: true, distance: 0 } as never;
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'Pike did not pick the items up; you took them back',
      detail: {},
    });
    expect(walk).toHaveBeenCalledOnce();
    expect(walk.mock.calls[0]?.[1]).toEqual(onGround.position);
  });

  it('says how many were picked up when only some were', async () => {
    const { world, run } = setup(5, { dropped: [7, 8], picked: [7] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: '1 of 2 were picked up; the rest are on the ground',
    });
  });

  it('fails interrupted when no dropped item is seen at all', async () => {
    const { world, run } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({
      status: 'failed',
      reason: 'interrupted',
    });
  });

  it('is cancelled when the run aborts while waiting for the pickup', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [], abortOnToss: true });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike')).toEqual({ status: 'cancelled', detail: {} });
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
    walk.mockImplementation(walkTo(world, new Vec3(-1.4, 64, 0.5)) as never);
    expect(await run('Pike')).toMatchObject({ status: 'completed' });
    expect(walk).toHaveBeenCalledOnce();
    const spot = walk.mock.calls[0]?.[1] as Vec3;
    expect(spot.x).toBeCloseTo(-1.4, 6);
    expect(spot.z).toBeCloseTo(0.5, 6);
    expect(spot.distanceTo(new Vec3(0.6, 64, 0.5))).toBeCloseTo(2, 6);
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
    expect(walk).toHaveBeenCalledOnce();
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

  it('completes when the recipient collects after a 4 s pickup delay (past the old 3 s window)', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [7], after: 4000 });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    expect(await run('Pike', 3, 'oak_log', 1)).toEqual({
      status: 'completed',
      detail: { to: 'Pike', item: 'oak_log', count: 3 },
    });
  }, 10_000);

  it('takes the items back when the recipient does not pick them up', async () => {
    const { world, run, events } = setup(5, { dropped: [7], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const item = { id: 7, name: 'item', type: 'other', position: new Vec3(0.5, 64, 3.5) };
    world.entities[7] = item;
    walk.mockImplementation(async (_bot, spot) => {
      world.me.position = spot as Vec3;
      events.emit('playerCollect', world.me, item);
      return { ok: true, distance: 1 } as never;
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'Pike did not pick the items up; you took them back',
      detail: {},
    });
    expect(walk.mock.calls[0]?.[1]).toEqual(item.position);
  });

  it('keeps the ground message when the items cannot be taken back', async () => {
    const { world, run } = setup(5, { dropped: [7], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.entities[7] = { name: 'item', type: 'other', position: new Vec3(0.5, 64, 3.5) };
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' } as never);
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'the items are on the ground near Pike',
    });
  });

  it('says the recipient did not pick up when the Body collected its own toss', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [7], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const item = { id: 7, name: 'item', type: 'other', position: new Vec3(0.5, 64, 3.5) };
    world.entities[7] = item;
    // The Body's own pickup: the item is collected, so the server removes it from the world.
    toss.mockImplementationOnce(async () => {
      events.emit('entitySpawn', item);
      events.emit('playerCollect', world.me, item);
      delete world.entities[7];
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'Pike did not pick the items up; you took them back',
      detail: {},
    });
    expect(walk).not.toHaveBeenCalled();
  });

  it('is cancelled when the run aborts while taking the items back', async () => {
    const { world, run, controller } = setup(5, { dropped: [7], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.entities[7] = { name: 'item', type: 'other', position: new Vec3(0.5, 64, 3.5) };
    walk.mockImplementation(async () => {
      controller.abort();
      return { ok: false, reason: 'cancelled', message: 'stopped' } as never;
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({ status: 'cancelled', detail: {} });
  });
});
