import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_IN_SIGHT } from './give.ts';
import { setup } from './give-test-fixture.ts';
import { moveNear } from './pathing.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
const walk = vi.mocked(moveNear);

beforeEach(() => walk.mockReset());

describe('give', () => {
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

  it('completes when a merged stack carries every tossed item, counting items not entities', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const stack = (id: number, count: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
      getDroppedItem: () => ({ count }),
    });
    toss.mockImplementationOnce(async () => {
      for (const id of [7, 8, 9]) events.emit('entitySpawn', stack(id, 1));
      events.emit('entityGone', stack(7, 1));
      events.emit('entityGone', stack(8, 1));
      events.emit('playerCollect', pike, stack(9, 3));
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({ status: 'completed' });
  });

  it('completes when the survivor of three merged tosses is re-announced with the merged count', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const stack = (id: number, count: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
      getDroppedItem: () => ({ count }),
    });
    // The real order: each toss spawns and announces a stack of 1; each merge re-announces the survivor.
    toss.mockImplementationOnce(async () => {
      for (const id of [7, 8, 9]) {
        events.emit('entitySpawn', stack(id, 1));
        events.emit('itemDrop', stack(id, 1));
      }
      events.emit('entityGone', stack(7, 1));
      events.emit('itemDrop', stack(9, 2));
      events.emit('entityGone', stack(8, 1));
      events.emit('itemDrop', stack(9, 3));
      events.emit('playerCollect', pike, stack(9, 3));
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({ status: 'completed' });
  });

  it('does not count an older stack within 8 blocks that a toss merges into', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const stack = (id: number, count: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
      getDroppedItem: () => ({ count }),
    });
    toss.mockImplementationOnce(async () => {
      // An older stack 3.5 blocks away: its metadata arrives, but it never spawns in this toss.
      events.emit('itemDrop', stack(5, 5));
      events.emit('entitySpawn', stack(7, 1));
      events.emit('itemDrop', stack(7, 3));
      events.emit('playerCollect', pike, stack(7, 3));
    });
    expect(await run('Pike', 3, 'oak_log', 0.01)).toMatchObject({ status: 'completed' });
  });

  it('says 2 of 3 and walks to the one item left on the ground after a merged stack', async () => {
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const stack = (id: number, count: number, z: number) => ({
      id,
      name: 'item',
      type: 'other',
      position: new Vec3(0.5, 64, z),
      getDroppedItem: () => ({ count }),
    });
    const remains = stack(9, 1, 4.5);
    world.entities[9] = remains;
    toss.mockImplementationOnce(async () => {
      events.emit('entitySpawn', stack(7, 1, 3.5));
      events.emit('entitySpawn', stack(8, 1, 3.5));
      events.emit('entitySpawn', remains);
      events.emit('entityGone', stack(7, 1, 3.5));
      events.emit('playerCollect', pike, stack(8, 2, 3.5));
    });
    walk.mockImplementation(async () => ({ ok: true, distance: 0 }) as never);
    expect(await run('Pike', 3, 'oak_log', 0.01)).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: '2 of 3 were picked up; the rest are on the ground',
      detail: {},
    });
    expect(walk).toHaveBeenCalledOnce();
    expect(walk.mock.calls[0]?.[1]).toEqual(remains.position);
  });

  it('does not throw on a real item entity whose metadata has not arrived, and takes its stack from itemDrop', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log');
    const { world, run } = setup(5, { real: { stack: 3 } });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const outcome = await run('Pike', 3);
    const lines = log.mock.calls.map((call) => String(call[0]));
    log.mockRestore();
    expect(outcome.status).toBe('completed');
    expect(lines.filter((line) => line.includes('give_listener_error'))).toEqual([]);
  });

  it('counts 1 for a real item the recipient collects before its metadata arrives, without throwing', async () => {
    const { world, run } = setup(5, { real: {} });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const outcome = await run('Pike', 1);
    expect(outcome.status).toBe('completed');
  });

  it('catches a listener whose body throws, logs it as one diag line, and does not rethrow', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log');
    const { world, run } = setup(5, { broken: true });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    // A short time scale: no item is seen, so the give waits out the pickup window, not the test.
    const outcome = await run('Pike', 3, 'oak_log', 0.01);
    const lines = log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('give_listener_error'))
      .map((line) => JSON.parse(line));
    log.mockRestore();
    expect(lines).toEqual([
      { event: 'give_listener_error', listener: 'entitySpawn', error: 'position unreadable' },
    ]);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });

  it('keeps a thrown value with no prototype and a failing diag sink away from the emitter', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {
      throw new Error('EPIPE');
    });
    const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const escaped: unknown[] = [];
    // A getter that throws a value with no prototype, which String() cannot convert.
    const hostile = {
      id: 7,
      get name(): string {
        throw Object.create(null);
      },
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
    };
    // A getter that throws an Error, when the diag sink also throws.
    const angry = {
      id: 8,
      get name(): string {
        throw new Error('position unreadable');
      },
      type: 'other',
      position: new Vec3(0.5, 64, 3.5),
    };
    toss.mockImplementationOnce(async () => {
      for (const entity of [hostile, angry]) {
        try {
          events.emit('entitySpawn', entity);
        } catch (error) {
          escaped.push(error);
        }
      }
    });
    await run('Pike', 3, 'oak_log', 0.01);
    log.mockRestore();
    expect(escaped).toEqual([]);
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
