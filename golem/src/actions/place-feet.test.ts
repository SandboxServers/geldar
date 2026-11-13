import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { block, type FakeBlock, type Scene, scriptedBot } from './escape-ladder.fakes.ts';
import { moveNear } from './pathing.ts';
import { fakeBot, place } from './place.fakes.ts';
import { placeAction } from './place.ts';

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

describe('place at feet as a pillar (decision 0160)', () => {
  /** A bot that jumps on the escape-ladder jump curve; placing puts dirt in the cell it left. */
  function pillarFake(blocks: Record<string, FakeBlock>, onGround = true, placeAt = '0,64,0') {
    const curve = [0.42, 0.753, 1.0, 1.166, 1.249];
    let airTicks = 0;
    const scene: Scene = {
      items: ['dirt'],
      blocks,
      physics: (s) => {
        if (!s.held || !s.controls.jump || fake.bot.placeBlock.mock.calls.length > 0) return;
        s.position.y = 64 + (curve[Math.min(airTicks, curve.length - 1)] ?? 1.249);
        airTicks++;
      },
    };
    const fake = scriptedBot(scene);
    Object.assign(fake.bot.entity, { onGround });
    fake.bot.placeBlock.mockImplementation(async () => {
      scene.blocks = { ...scene.blocks, [placeAt]: block('dirt') };
    });
    return fake;
  }

  const pillar = (fake: ReturnType<typeof pillarFake>, signal = new AbortController().signal) =>
    placeAction.run(
      { bot: fake.asBot, signal, timeScale: 1 },
      { do: 'place', block: 'dirt', at: 'feet' },
    );

  it('places the block in the cell the feet were in, and the bot ends a block higher', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    const [reference, face] = fake.bot.placeBlock.mock.calls[0] as unknown as [unknown, Vec3];
    expect(reference).toEqual(block('stone'));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.state.blockAt(new Vec3(0, 64, 0)).name).toBe('dirt');
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
    expect(fake.bot.dig).not.toHaveBeenCalled();
  });

  it('uses a dirt path under the feet as the ground: the feet cell is above it, so the pillar goes up from it', async () => {
    const fake = pillarFake({
      '0,63,0': { ...block('dirt_path'), shapes: [[0, 0, 0, 1, 0.9375, 1]] },
    });
    fake.state.position.y = 63.9375;
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    const [reference] = fake.bot.placeBlock.mock.calls[0] as unknown as [{ name: string }, Vec3];
    expect(reference.name).toBe('dirt_path');
    expect(fake.state.blockAt(new Vec3(0, 64, 0)).name).toBe('dirt');
  });

  it('refuses with a no-headroom message and places nothing under bedrock two cells above the head', async () => {
    const fake = pillarFake({ '0,63,0': block('stone'), '0,66,0': block('bedrock') });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('no headroom for a pillar'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses when the bot is not on the ground', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') }, false);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('not on the ground'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses when no solid block is under the feet', async () => {
    const fake = pillarFake({});
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('no solid block under your feet'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('fails without placing when the bot never rises high enough', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    fake.bot.waitForTicks.mockImplementation(async () => undefined);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('is cancelled, and places nothing, when the signal aborts mid-jump', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    const abort = new AbortController();
    fake.bot.waitForTicks.mockImplementationOnce(async () => {
      abort.abort();
    });
    const outcome = await pillar(fake, abort.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a pillar when another entity box overlaps the cell the block goes into', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(0.3, 64, 0.3), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'another entity stands where the block goes',
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a pillar when a friend in the next cell reaches into the cell', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(1.1, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('places when a friend stands in the next cell 0.35 from the target face', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(1.65, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('places when a friend only touches the cell face (flush contact is not a collision)', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(-0.3, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('holds the sneak through a placement against a crafting table, and releases it after', async () => {
    const fake = pillarFake({ '0,63,0': block('crafting_table') });
    const held: unknown[] = [];
    fake.bot.placeBlock.mockImplementation(async () => {
      held.push(fake.state.controls.sneak);
    });
    await pillar(fake);
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(held).toEqual([true]);
    expect(fake.state.controls.sneak).toBe(false);
  });

  it('does not sneak for a pillar on plain stone', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    await pillar(fake);
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.bot.setControlState).not.toHaveBeenCalledWith('sneak', expect.anything());
  });

  describe('when the headroom above the feet is unsafe', () => {
    // Stone two cells up with gravel above it: digging the stone would drop the gravel on the bot.
    const unsafe = { '0,66,0': block('stone'), '0,67,0': block('gravel') };

    it('steps to a neighbour whose headroom is clear, and pillars there', async () => {
      const fake = pillarFake(
        { '0,63,0': block('stone'), '1,63,0': block('stone'), ...unsafe },
        true,
        '1,64,0',
      );
      vi.mocked(moveNear).mockClear();
      vi.mocked(moveNear).mockImplementationOnce(async () => {
        fake.state.position.x = 1.5;
        return { ok: true, distance: 0 };
      });
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({ status: 'completed' });
      expect(moveNear).toHaveBeenCalledTimes(1);
      expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
      expect(fake.state.blockAt(new Vec3(1, 64, 0)).name).toBe('dirt');
      expect(fake.bot.dig).not.toHaveBeenCalled();
    });

    it('keeps the headroom refusal, and does not move, when no neighbour has a solid ground', async () => {
      const fake = pillarFake({ '0,63,0': block('stone'), ...unsafe });
      vi.mocked(moveNear).mockClear();
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message: expect.stringContaining('no headroom for a pillar: stone is unsafe to dig'),
      });
      expect(moveNear).not.toHaveBeenCalled();
      expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    });

    it('does not step to a neighbour whose own headroom is unsafe too', async () => {
      const fake = pillarFake({
        '0,63,0': block('stone'),
        '1,63,0': block('stone'),
        '1,66,0': block('stone'),
        '1,67,0': block('gravel'),
        ...unsafe,
      });
      vi.mocked(moveNear).mockClear();
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message: expect.stringContaining('no headroom for a pillar'),
      });
      expect(moveNear).not.toHaveBeenCalled();
      expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    });
  });
});

describe('placing against a block that opens on use', () => {
  it('holds the sneak while placing against a crafting table, and releases it after', async () => {
    const fake = fakeBot({ blocks: { '10,63,0': 'crafting_table' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(fake.setControlState.mock.calls).toEqual([
      ['sneak', true],
      ['sneak', false],
    ]);
    const [on, off] = fake.setControlState.mock.invocationCallOrder;
    const placed = fake.placeBlock.mock.invocationCallOrder[0] ?? 0;
    expect(on).toBeLessThan(placed);
    expect(placed).toBeLessThan(off ?? 0);
  });

  it('releases the sneak when the placement throws', async () => {
    const fake = fakeBot({
      blocks: { '10,63,0': 'crafting_table' },
      items: ['dirt'],
      placeError: 'socket closed',
    });
    await expect(place(fake, 'dirt', { x: 10, y: 64, z: 0 })).rejects.toThrow('socket closed');
    expect(fake.setControlState.mock.calls).toEqual([
      ['sneak', true],
      ['sneak', false],
    ]);
  });

  it('does not sneak when the reference is plain stone', async () => {
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(fake.setControlState).not.toHaveBeenCalled();
  });
});
