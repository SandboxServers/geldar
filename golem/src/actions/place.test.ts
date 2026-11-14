import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { fakeBot, place } from './place.fakes.ts';
import { confirmsPlacement, pickReference, placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
  // A completed walk leaves the bot within its range of the target, on the x axis.
  vi.mocked(moveNear).mockImplementation(async (bot, target, range) => {
    const goal = new Vec3(target.x, target.y, target.z);
    if (bot.entity.position.distanceTo(goal) > range) {
      bot.entity.position = new Vec3(goal.x + 0.5 - range, goal.y, goal.z + 0.5);
    }
    return { ok: true, distance: 0 };
  });
});

describe('pickReference', () => {
  it('returns the first solid candidate in order', () => {
    expect(pickReference([false, true, true])).toBe(1);
    expect(pickReference([true, false])).toBe(0);
  });

  it('returns null when no candidate is solid', () => {
    expect(pickReference([false, false])).toBeNull();
    expect(pickReference([])).toBeNull();
  });
});

describe('confirmsPlacement', () => {
  it('accepts the block name and its wall form', () => {
    expect(confirmsPlacement('torch', 'torch')).toBe(true);
    expect(confirmsPlacement('wall_torch', 'torch')).toBe(true);
    expect(confirmsPlacement('air', 'torch')).toBe(false);
  });
});

describe('place reference selection', () => {
  const ground = { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,1': 'stone' };

  it('places a crafting table next to a solid block with the item in hand', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone' },
      items: ['crafting_table'],
    });
    const outcome = await place(fake, 'crafting_table', { x: 0, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.bot.heldItem?.name).toBe('crafting_table');
  });

  it('places dirt at a coordinate against the block below', async () => {
    const fake = fakeBot({ blocks: ground, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 1, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    const [reference, face] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position).toEqual(new Vec3(1, 63, 1));
    expect(face).toEqual(new Vec3(0, 1, 0));
  });

  it('tries the next solid neighbour when the server refuses the first', async () => {
    const fake = fakeBot({
      blocks: { ...ground, '2,64,1': 'stone' },
      items: ['crafting_table'],
      refuseFirst: 1,
    });
    const outcome = await place(fake, 'crafting_table', { x: 1, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(2);
    const [second] = fake.placeBlock.mock.calls[1] as [{ position: Vec3 }];
    expect(second.position).toEqual(new Vec3(2, 64, 1));
  });

  it('fails with the refused text when every neighbour is refused', async () => {
    const fake = fakeBot({ blocks: ground, items: ['dirt'], refuseFirst: 9 });
    const outcome = await place(fake, 'dirt', { x: 1, y: 64, z: 1 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('the server refused'),
    });
  });

  it('stops at the next neighbour when the action is aborted after a refusal', async () => {
    const fake = fakeBot({
      blocks: { ...ground, '2,64,1': 'stone' },
      items: ['dirt'],
      refuseFirst: 1,
    });
    const abort = new AbortController();
    fake.placeBlock.mockImplementationOnce(async () => {
      abort.abort();
      throw new Error('server refused to place');
    });
    const outcome = await placeAction.run(
      { bot: fake.bot, signal: abort.signal, timeScale: 1 },
      { do: 'place', block: 'dirt', at: { x: 1, y: 64, z: 1 } },
    );
    expect(outcome.status).toBe('cancelled');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
  });
});

describe('place', () => {
  it('places a non-collision block at feet against the block below', async () => {
    const fake = fakeBot({ blocks: { '0,63,0': 'stone' }, items: ['torch'] });
    const outcome = await place(fake, 'torch', 'feet');
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
    const [reference, face] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position).toEqual(new Vec3(0, 63, 0));
    expect(face).toEqual(new Vec3(0, 1, 0));
  });

  it('moves a target at the bot head cell beside the bot too', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone' },
      items: ['dirt'],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome.status).toBe('completed');
    const [reference] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }];
    expect(reference.position).toEqual(new Vec3(0, 63, 1));
  });

  it('skips a neighbor that an entity stands in', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,0': 'stone' },
      items: ['dirt'],
      entities: [new Vec3(0.5, 64, 1.5)],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome.status).toBe('completed');
    const [reference] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }];
    expect(reference.position).toEqual(new Vec3(1, 63, 0));
  });

  it('fails with the no-space message when every neighbor is a solid block', async () => {
    const fake = fakeBot({
      blocks: {
        '0,63,0': 'stone',
        '0,64,1': 'stone',
        '1,64,0': 'stone',
        '-1,64,0': 'stone',
        '0,64,-1': 'stone',
      },
      items: ['dirt'],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no free space next to you',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('fails with the no-space message when every neighbor holds an entity', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,0': 'stone', '-1,63,0': 'stone' },
      items: ['dirt'],
      entities: [
        new Vec3(0.5, 64, 1.5),
        new Vec3(1.5, 64, 0.5),
        new Vec3(-0.5, 64, 0.5),
        new Vec3(0.5, 64, -0.5),
      ],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no free space next to you',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('places a bed second half one further in the same direction', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '0,64,2': 'stone', '1,63,0': 'stone' },
      items: ['white_bed'],
    });
    const outcome = await place(fake, 'white_bed', 'feet');
    expect(outcome.status).toBe('completed');
    const [reference, face] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position).toEqual(new Vec3(1, 63, 0));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.look).toHaveBeenCalledWith(-Math.PI / 2, 0, true);
  });

  it('refuses a target that is occupied', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone', '2,64,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target is occupied',
    });
  });

  it('fails with missing_materials when the block is not in the inventory', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone' } });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'missing_materials' });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('fails with not_possible for a name that is not a block', async () => {
    const fake = fakeBot({ items: ['nonexistent'] });
    const outcome = await place(fake, 'nonexistent', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
  });

  it('returns the move failure without placing', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'timeout',
      message: 'too slow',
    });
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout', message: 'too slow' });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('does not place after a partial walk, and says the target is out of reach', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({ ok: true, partial: true, distance: 6 } as never);
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the target is out of reach',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('prefers the solid block below over a solid side neighbor', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone', '3,64,0': 'stone' }, items: ['dirt'] });
    await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    const [reference] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }];
    expect(reference.position).toEqual(new Vec3(2, 63, 0));
  });

  it('confirms a torch placed on a side face as wall_torch', async () => {
    const fake = fakeBot({
      blocks: { '2,64,0': 'stone' },
      items: ['torch'],
      placedAs: 'wall_torch',
    });
    const outcome = await place(fake, 'torch', { x: 1, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    const [, face] = fake.placeBlock.mock.calls[0] as [unknown, Vec3];
    expect(face).toEqual(new Vec3(-1, 0, 0));
  });

  it('fails as blocked with a what-to-do message when the block does not appear', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone' }, items: ['dirt'], placedAs: 'air' });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the block did not appear at the target',
    });
  });

  it('fails as blocked with a fixed message when there is nothing solid to place against', async () => {
    const fake = fakeBot({ items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no solid block to place against',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('maps a placement timeout to timeout with a fixed message', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Bot did not answer the placement',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message: 'the server did not answer the placement',
    });
  });

  it('maps a refused placement to blocked with a fixed message', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Server refused to place dirt at (2, 64, 0): the block is still air',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the server refused the placement',
    });
  });

  it('rethrows other placement errors', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone' }, items: ['dirt'], placeError: 'boom' });
    await expect(place(fake, 'dirt', { x: 2, y: 64, z: 0 })).rejects.toThrow('boom');
  });

  it('is cancelled when the walk is cancelled', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'cancelled',
      message: 'stopped',
    });
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('cancelled');
  });
});

it('a block beside a dirt path under the feet is placed, not refused inside a block', async () => {
  const fake = fakeBot({
    blocks: { '0,62,0': 'dirt_path', '1,62,0': 'stone' },
    items: ['cobblestone'],
    at: new Vec3(0.5, 62.9375, 0.5),
  });
  const outcome = await place(fake, 'cobblestone', { x: 1, y: 63, z: 0 });
  expect(outcome).toMatchObject({ status: 'completed' });
  expect(fake.placeBlock).toHaveBeenCalledTimes(1);
});
