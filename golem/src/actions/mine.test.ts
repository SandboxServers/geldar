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

  it('refuses a block with water beside it, and one with gravel above the bot', async () => {
    const stone = block(STONE, new Vec3(3, 64, 0), [], { 270: true }, 'stone');
    const water = block(WATER, new Vec3(3, 65, 0), [], undefined, 'water');
    const wet = fakeBot([stone, water]);
    expect(await mine(wet, 1, 'stone')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'stone is unsafe to dig: water would flow in on you',
    });
    expect(wet.dig).not.toHaveBeenCalled();

    const gravel = block(GRAVEL, new Vec3(0, 66, 0), [], undefined, 'gravel');
    const above = block(STONE, new Vec3(0, 65, 0), [], undefined, 'stone');
    const bot = fakeBot([above, gravel]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'stone is unsafe to dig: gravel above it would fall on you',
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('returns not_possible and never digs a block under the bot', async () => {
    const under = block(OAK_LOG, new Vec3(0, 63, 0), [OAK_LOG]);
    const bot = fakeBot([under]);
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      detail: { mined: 0 },
    });
    expect(bot.dig).not.toHaveBeenCalled();
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

  it('fails not_possible when the reach walk ends on the block, and digs nothing', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG])]);
    // Out of dig reach, so the walk runs; it moves the bot onto the cell above the block.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      detail: { mined: 0 },
    });
    expect(bot.dig).not.toHaveBeenCalled();
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

  it('fails not_possible when the retry walk ends on the block, and digs nothing more', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Block is not in view'));
    // The walk moves the bot onto the cell above the block, so the block is under its feet.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      detail: { mined: 0 },
    });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs the wall beside the bot, not the stone under its feet', async () => {
    // The floor is listed first: the fake returns matches in order, as Mineflayer returns the nearest.
    const floor = block(STONE, new Vec3(0, 63, 0), [], undefined, 'stone');
    const wall = block(STONE, new Vec3(1, 64, 0), [], undefined, 'stone');
    const bot = fakeBot([floor, wall]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({
      status: 'completed',
      detail: { mined: 1 },
    });
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.dig.mock.calls[0]?.[0]).toBe(wall);
    expect(floor.type).toBe(STONE);
  });

  it('fails would drop you when the only stone in reach is under its feet', async () => {
    const floor = block(STONE, new Vec3(0, 63, 0), [], undefined, 'stone');
    const bot = fakeBot([floor]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'would drop you',
      detail: { mined: 0 },
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('digs the next block when the walk to a target ends with the bot on it', async () => {
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
    expect(bot.dig.mock.calls[0]?.[0]).toBe(next);
    expect(target.type).toBe(OAK_LOG);
  });

  it('digs the next block when the retry walk ends with the bot on the block', async () => {
    const target = block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG]);
    const next = block(OAK_LOG, new Vec3(6, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target, next]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Block is not in view'));
    // The retry walk ends on the first target, so the bot stands on it and it is skipped.
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(2);
    expect(bot.dig.mock.calls[0]?.[0]).toBe(target);
    expect(bot.dig.mock.calls[1]?.[0]).toBe(next);
    expect(target.type).toBe(OAK_LOG);
  });

  it('ends with would drop you when every walk target ends under it, one walk each', async () => {
    const targets = [
      block(OAK_LOG, new Vec3(3, 63, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(4, 63, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(5, 63, 0), [OAK_LOG]),
    ];
    const bot = fakeBot(targets);
    // Every walk ends on its target, so each candidate is skipped once and none is dug.
    vi.mocked(moveNear).mockImplementation(async (_walker, at) => {
      bot.entity.position = new Vec3(at.x, at.y + 1, at.z);
      return { ok: true, distance: 0 };
    });
    expect(await mine(bot, 1)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'would drop you',
      detail: { mined: 0 },
    });
    expect(vi.mocked(moveNear)).toHaveBeenCalledTimes(3);
    expect(bot.dig).not.toHaveBeenCalled();
  });
});
