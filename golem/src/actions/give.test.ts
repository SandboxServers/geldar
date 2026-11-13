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
    for (const id of pickups.picked ?? [7]) events.emit('playerCollect', pike, item(id));
    if (pickups.abortOnToss) controller.abort();
  });
  const lookAt = vi.fn(async () => {});
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
  return { world, run, toss, lookAt, events };
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
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'the items are on the ground near Pike',
    });
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
