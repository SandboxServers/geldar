import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BEDROCK, block, fakeBot, GRAVEL, mine, OAK_LOG, STONE, WATER } from './mine.fakes.ts';
import { type ItemStack, inventoryDelta } from './mine.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

describe('inventoryDelta', () => {
  it('keeps positive gains and omits entries that shrank or did not change', () => {
    const before: ItemStack[] = [
      { name: 'cobblestone', count: 3 },
      { name: 'oak_log', count: 2 },
      { name: 'dirt', count: 5 },
    ];
    const after: ItemStack[] = [
      { name: 'cobblestone', count: 5 },
      { name: 'oak_log', count: 1 },
      { name: 'dirt', count: 5 },
    ];
    expect(inventoryDelta(before, after)).toEqual({ cobblestone: 2 });
  });

  it('counts an item that appears, and sums the stacks of one name', () => {
    const before: ItemStack[] = [
      { name: 'oak_log', count: 1 },
      { name: 'oak_log', count: 2 },
    ];
    const after: ItemStack[] = [
      { name: 'oak_log', count: 4 },
      { name: 'stick', count: 6 },
    ];
    expect(inventoryDelta(before, after)).toEqual({ oak_log: 1, stick: 6 });
  });
});

describe('mineAction', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  it('returns not_found with mined 0 when no block is in reach', async () => {
    const bot = fakeBot([]);
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_found',
      detail: { mined: 0 },
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('digs stone bare-handed, and says it took longer and dropped nothing', async () => {
    const stone = block(STONE, new Vec3(3, 64, 0), [], { 270: true }, 'stone');
    const bot = fakeBot([stone]);
    const outcome = await mine(bot, 1, 'stone');
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      status: 'completed',
      detail: {
        mined: 1,
        collected: {},
        note: expect.stringMatching(/stone was dug without a suitable tool.*dropped nothing/),
      },
    });
  });

  it('refuses an unbreakable block with a typed reason and never digs', async () => {
    const bedrock = block(BEDROCK, new Vec3(3, 64, 0), [], undefined, 'bedrock');
    const bot = fakeBot([bedrock]);
    expect(await mine(bot, 1, 'bedrock')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'bedrock cannot be broken by anyone, with any tool',
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('digs a block with water beside it, and one with gravel above the bot (decision 0428)', async () => {
    const stone = block(STONE, new Vec3(3, 64, 0), [], { 270: true }, 'stone');
    const water = block(WATER, new Vec3(3, 65, 0), [], undefined, 'water');
    const wet = fakeBot([stone, water]);
    expect(await mine(wet, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(wet.dig).toHaveBeenCalledTimes(1);

    const gravel = block(GRAVEL, new Vec3(0, 66, 0), [], undefined, 'gravel');
    const above = block(STONE, new Vec3(0, 65, 0), [], undefined, 'stone');
    const bot = fakeBot([above, gravel]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs a stone beside a 1x2 pit with gravel above it, and takes the fall (decision 0428)', async () => {
    const OAK = OAK_LOG;
    const walls = [
      block(OAK, new Vec3(-1, 64, 0), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(-1, 65, 0), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 64, -1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 64, 1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 65, -1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 65, 1), [OAK], undefined, 'oak_log'),
    ];
    const stone = block(STONE, new Vec3(1, 64, 0), [], { 270: true }, 'stone');
    const gravel = block(GRAVEL, new Vec3(1, 65, 0), [], undefined, 'gravel');
    const bot = fakeBot([...walls, stone, gravel]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs gravel in a 1-wide pit with the Body walled in (decision 0428)', async () => {
    const OAK = OAK_LOG;
    const walls = [
      block(OAK, new Vec3(0, 63, 0), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(-1, 64, 0), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(-1, 65, 0), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 64, -1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 64, 1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 65, -1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(0, 65, 1), [OAK], undefined, 'oak_log'),
      block(OAK, new Vec3(1, 65, 0), [OAK], undefined, 'oak_log'),
    ];
    const gravel = block(GRAVEL, new Vec3(1, 64, 0), [], undefined, 'gravel');
    const bot = fakeBot([...walls, gravel]);
    expect(await mine(bot, 1, 'gravel')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs each falling block type above a stone the Body stands beside (decision 0428)', async () => {
    const types = [
      'sand',
      'red_sand',
      'anvil',
      'chipped_anvil',
      'damaged_anvil',
      'suspicious_sand',
      'suspicious_gravel',
      'dragon_egg',
      'white_concrete_powder',
    ];
    for (const name of types) {
      const stone = block(STONE, new Vec3(1, 64, 0), [], { 270: true }, 'stone');
      const falling = block(999, new Vec3(1, 65, 0), [], undefined, name);
      const bot = fakeBot([stone, falling]);
      expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
      expect(bot.dig).toHaveBeenCalledTimes(1);
    }
  });

  it('digs gravel and a stone with gravel above it in open ground, far from the Body', async () => {
    const gravel = block(GRAVEL, new Vec3(3, 64, 0), [], undefined, 'gravel');
    expect(await mine(fakeBot([gravel]), 1, 'gravel')).toMatchObject({ status: 'completed' });
    const stone = block(STONE, new Vec3(5, 64, 0), [], { 270: true }, 'stone');
    const above = block(GRAVEL, new Vec3(5, 65, 0), [], undefined, 'gravel');
    const far = fakeBot([stone, above]);
    expect(await mine(far, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(far.dig).toHaveBeenCalledTimes(1);
  });

  it('digs the block under the bot when it is the only one in reach (decision 0428)', async () => {
    const under = block(OAK_LOG, new Vec3(0, 63, 0), [OAK_LOG]);
    const bot = fakeBot([under]);
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('returns invalid_args for a name that is not a block', async () => {
    const bot = fakeBot([]);
    expect(await mine(bot, 1, 'not_a_block')).toMatchObject({
      status: 'failed',
      reason: 'invalid_args',
    });
    expect(bot.findBlocks).not.toHaveBeenCalled();
  });

  it('completes with the blocks broken and what the inventory gained', async () => {
    const logs = [
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(3, 64, 0), [OAK_LOG]),
    ];
    const bot = fakeBot(logs);
    expect(await mine(bot, 2)).toEqual({
      status: 'completed',
      detail: {
        mined: 2,
        collected: { oak_log: 2 },
        hint: expect.stringContaining('the space is open'),
      },
    });
  });

  it('returns not_found with the count so far when fewer blocks exist', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    expect(await mine(bot, 3)).toMatchObject({
      status: 'failed',
      reason: 'not_found',
      detail: { mined: 1 },
    });
  });

  it('fails with the move reason and the count so far when the walk is blocked', async () => {
    vi.mocked(moveNear).mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });
    const bot = fakeBot([block(OAK_LOG, new Vec3(9, 64, 0), [OAK_LOG])]);
    expect(await mine(bot, 1)).toEqual({
      status: 'failed',
      reason: 'blocked',
      message: 'no path',
      detail: { mined: 0 },
    });
  });

  it('skips the walk to a block the bot can already dig from where it stands', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await mine(bot, 1);
    expect(outcome.status).toBe('completed');
    // Only the pickup walk is left; the reach walk (range 3) was skipped.
    expect(vi.mocked(moveNear).mock.calls.map(([, , range]) => range)).toEqual([0]);
  });

  it('digs the block the reach walk ends on, with the bot on it (decision 0428)', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG])]);
    // Out of dig reach, so the walk runs; it moves the bot onto the cell above the block.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('walks once toward a block that is not in view, then digs it again', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Block is not in view'));
    expect(await mine(bot, 1)).toEqual({
      status: 'completed',
      detail: {
        mined: 1,
        collected: { oak_log: 1 },
        hint: expect.stringContaining('the space is open'),
      },
    });
    expect(bot.dig).toHaveBeenCalledTimes(2);
    // The retry walk (range 3) comes between the two digs; the pickup walk (range 0) is last.
    expect(vi.mocked(moveNear).mock.calls.map(([, , range]) => range)).toEqual([3, 0]);
  });

  it('fails blocked and digs no more than twice when the retry is still not in view', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValue(new Error('Block is not in view'));
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      detail: { mined: 0 },
    });
    expect(bot.dig).toHaveBeenCalledTimes(2);
  });

  it('digs the block the retry walk ends on, with the bot on it (decision 0428)', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Block is not in view'));
    // The walk moves the bot onto the cell above the block, so the block is under its feet.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(2);
  });

  it('digs the stone under its feet when it is the nearest, as the wall is not (decision 0428)', async () => {
    // The floor is listed first: the fake returns matches in order, as Mineflayer returns the nearest.
    const floor = block(STONE, new Vec3(0, 63, 0), [], undefined, 'stone');
    const wall = block(STONE, new Vec3(1, 64, 0), [], undefined, 'stone');
    const bot = fakeBot([floor, wall]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({
      status: 'completed',
      detail: { mined: 1 },
    });
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.dig.mock.calls[0]?.[0]).toBe(floor);
  });

  it('digs the only stone in reach when it is under its feet (decision 0428)', async () => {
    const floor = block(STONE, new Vec3(0, 63, 0), [], undefined, 'stone');
    const bot = fakeBot([floor]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({
      status: 'completed',
      detail: { mined: 1 },
    });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs the target when the walk to it ends with the bot on it (decision 0428)', async () => {
    const target = block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG]);
    const next = block(OAK_LOG, new Vec3(6, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target, next]);
    // The walk to the first target ends on it, so the bot stands on it.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.dig.mock.calls[0]?.[0]).toBe(target);
  });

  it('digs the target when the retry walk ends with the bot on it (decision 0428)', async () => {
    const target = block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG]);
    const next = block(OAK_LOG, new Vec3(6, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target, next]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Block is not in view'));
    // The retry walk ends on the first target, so the bot stands on it; it is dug all the same.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(2);
    expect(bot.dig.mock.calls[1]?.[0]).toBe(target);
  });

  it('digs a walk target that ends under the bot, one walk for it (decision 0428)', async () => {
    const targets = [
      block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(4, 63, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(5, 63, 0), [OAK_LOG]),
    ];
    const bot = fakeBot(targets);
    // Every walk ends on its target; the first one reached is dug and the action completes.
    vi.mocked(moveNear).mockImplementation(async (_walker, at) => {
      bot.entity.position = new Vec3(at.x, at.y + 1, at.z);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });
});
