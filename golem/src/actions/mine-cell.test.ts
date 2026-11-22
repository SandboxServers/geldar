import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BEDROCK, block, ctxFor, fakeBot, mine, OAK_LOG, STONE } from './mine.fakes.ts';
import { mineAction } from './mine.ts';
import { completed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { ActionRegistry, runAction } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

const CELL = { x: 1, y: 64, z: 0 };

/** One mine of `count` blocks named `name`, aimed at the exact cell `at` (decision 0349). */
function mineCell(
  bot: ReturnType<typeof fakeBot>,
  at: { x: number; y: number; z: number },
  name = 'oak_log',
  count = 1,
) {
  return mineAction.run({ ...ctxFor(bot), mineAt: at }, { do: 'mine', block: name, count });
}

describe('mineAction with an exact cell', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  it('digs exactly the named cell, never a nearer block of the same name', async () => {
    const other = block(OAK_LOG, new Vec3(-1, 64, 0), [OAK_LOG]);
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([other, target]);
    bot.entity.position = new Vec3(-2, 64, 0);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await mineCell(bot, CELL);
    expect(outcome.status).toBe('completed');
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.dig).toHaveBeenCalledWith(target);
    expect(other.type).toBe(OAK_LOG);
    expect(bot.findBlocks).not.toHaveBeenCalled();
  });

  it('fails not_possible when the cell is not loaded, and walks and digs nothing', async () => {
    const bot = fakeBot([]);
    const outcome = await mineCell(bot, { x: 5, y: 64, z: 5 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'target is not loaded',
      detail: { mined: 0 },
    });
    expect(moveNear).not.toHaveBeenCalled();
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('fails not_found when the cell holds another block, and digs nothing', async () => {
    const stone = block(STONE, new Vec3(1, 64, 0), [], undefined, 'stone');
    const log = block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]);
    const bot = fakeBot([stone, log]);
    const outcome = await mineCell(bot, CELL);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_found',
      message: 'that block is stone',
    });
    expect(bot.dig).not.toHaveBeenCalled();
    expect(bot.findBlocks).not.toHaveBeenCalled();
  });

  it('fails out_of_reach when the walk ends with the cell still out of dig reach', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    const outcome = await mineCell(bot, CELL);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'out_of_reach',
      message: 'the target is out of reach',
      detail: { mined: 0 },
    });
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('fails not_found when the cell changed during the walk, and digs nothing', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValueOnce(false).mockReturnValue(true);
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      target.type = 0;
      Object.assign(target, { name: 'air' });
      return { ok: true, distance: 0 };
    });
    const outcome = await mineCell(bot, CELL);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_found',
      message: 'that block is air',
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('refuses a cell that is not whole numbers, and a count other than one', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    expect(await mineCell(bot, { x: 1.5, y: 64, z: 0 })).toMatchObject({
      status: 'failed',
      reason: 'invalid_args',
      message: 'the cell must be whole block numbers',
    });
    expect(await mineCell(bot, CELL, 'oak_log', 2)).toMatchObject({
      status: 'failed',
      reason: 'invalid_args',
      message: 'an exact cell is one block',
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('digs the exact cell under the feet, and the agent takes the fall (decision 0428)', async () => {
    const under = block(OAK_LOG, new Vec3(0, 63, 0), [OAK_LOG]);
    const bot = fakeBot([under]);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await mineCell(bot, { x: 0, y: 63, z: 0 });
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('fails not_possible with the refusal text when the cell holds an unbreakable block', async () => {
    const bedrock = block(BEDROCK, new Vec3(1, 64, 0), [], undefined, 'bedrock');
    const bot = fakeBot([bedrock]);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await mineCell(bot, CELL, 'bedrock');
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'bedrock cannot be broken by anyone, with any tool',
      detail: { mined: 0 },
    });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('without a cell, mine still takes the nearest block of the name', async () => {
    const other = block(OAK_LOG, new Vec3(-1, 64, 0), [OAK_LOG]);
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([other, target]);
    bot.entity.position = new Vec3(-2, 64, 0);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await mine(bot, 1);
    expect(outcome.status).toBe('completed');
    expect(bot.findBlocks).toHaveBeenCalled();
    expect(bot.dig).toHaveBeenCalledWith(other);
  });
});

describe('runAction and the exact cell', () => {
  it('refuses an exact cell on any verb but mine', async () => {
    const registry = new ActionRegistry();
    const run = vi.fn(async () => completed());
    registry.register({ kind: 'wait', timeoutMs: 1000, run });
    const bot = fakeBot([]) as unknown as Bot;
    const result = await runAction(registry, bot, { do: 'wait', seconds: 1 }, { mineAt: CELL });
    expect(result.state).toBe('failed');
    expect(result.result.reason).toBe('invalid_args');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses an at field on a mine from every source', async () => {
    const registry = new ActionRegistry();
    registry.register(mineAction);
    const bot = fakeBot([]) as unknown as Bot;
    const result = await runAction(registry, bot, {
      do: 'mine',
      block: 'stone',
      count: 1,
      at: CELL,
    });
    expect(result.state).toBe('failed');
    expect(result.result.reason).toBe('invalid_args');
  });
});
