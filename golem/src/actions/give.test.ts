import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWorld } from '../perception/perception.fakes.ts';
import { giveAction, NOT_IN_SIGHT } from './give.ts';
import type { ActionOutcome } from './outcome.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
const walk = vi.mocked(moveNear);

/** A fake world with a Kestrel bot at the origin, 5 oak_log in the inventory, and a toss spy. */
function setup(held = 5) {
  const world = new FakeWorld();
  const toss = vi.fn(async () => {});
  const lookAt = vi.fn(async () => {});
  // The server's full player list: a player listed here is known to the server, not to the agent.
  const players: Record<string, unknown> = { Hidden: { entity: { position: new Vec3(0, 64, 5) } } };
  const bot = Object.assign(world.bot, {
    players,
    inventory: { items: () => [{ name: 'oak_log', count: held }] },
    registry: { items: {}, itemsByName: { oak_log: { id: 42 } } },
    toss,
    lookAt,
  }) as Bot;
  const run = (to: string, count = 3, item = 'oak_log'): Promise<ActionOutcome> =>
    giveAction.run(
      { bot, signal: new AbortController().signal, timeScale: 1 },
      {
        do: 'give',
        to,
        item,
        count,
      },
    );
  return { world, run, toss, lookAt };
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
});
