import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDING_REFUSAL } from '../building/names.ts';
import { breakAction, breakHandler } from './break.ts';
import {
  BEDROCK,
  block,
  COBBLESTONE,
  ctxFor,
  fakeBot,
  OAK_LOG,
  STONE,
  WATER,
} from './mine.fakes.ts';
import type { MoveResult } from './pathing.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

const CELL = { x: 1, y: 64, z: 0 };
const GRAVEL = 13;

/** A walk that ended short: a failed move with the given reason. */
function walkFailed(reason: string): MoveResult {
  return { ok: false, reason, distance: 0 } as unknown as MoveResult;
}

/** One break of the exact cell `at`, with the flag on. */
function breakCell(bot: ReturnType<typeof fakeBot>, at = CELL, signal?: AbortSignal) {
  return breakHandler(true).run(ctxFor(bot, signal), { do: 'break', at });
}

describe('break action', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  it('is refused with the neutral message while the flag is off, and digs nothing', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await breakAction.run(ctxFor(bot), { do: 'break', at: CELL });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: BUILDING_REFUSAL,
    });
    expect(bot.dig).not.toHaveBeenCalled();
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('breaks the named cell and not the nearest block of its kind', async () => {
    const other = block(OAK_LOG, new Vec3(-1, 64, 0), [OAK_LOG]);
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([other, target]);
    bot.entity.position = new Vec3(-2, 64, 0);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({
      status: 'completed',
      detail: { collected: { oak_log: 1 } },
    });
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.dig).toHaveBeenCalledWith(target);
    expect(other.type).toBe(OAK_LOG);
    expect(bot.findBlocks).not.toHaveBeenCalled();
  });

  it('refuses bedrock as unbreakable, and walks and digs nothing', async () => {
    const bedrock = block(BEDROCK, new Vec3(1, 64, 0), [], undefined, 'bedrock');
    const bot = fakeBot([bedrock]);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(outcome.status === 'failed' && outcome.message).toContain('bedrock');
    expect(moveNear).not.toHaveBeenCalled();
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('digs a stone cell with lava-like liquid and a falling column beside it, without refusal', async () => {
    const target = block(STONE, new Vec3(1, 64, 0), [COBBLESTONE]);
    const liquid = block(WATER, new Vec3(2, 64, 0), []);
    const falling = block(GRAVEL, new Vec3(1, 65, 0), [GRAVEL]);
    const bot = fakeBot([target, liquid, falling]);
    bot.entity.position = new Vec3(1, 64, 2);
    bot.canDigBlock.mockReturnValue(true);
    const outcome = await breakCell(bot);
    expect(outcome.status).toBe('completed');
    expect(bot.dig).toHaveBeenCalledWith(target);
    expect(falling.type).toBe(GRAVEL);
  });

  it('walks within reach of an out-of-reach cell, then breaks it', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValueOnce(false).mockReturnValue(true);
    const outcome = await breakCell(bot);
    expect(outcome.status).toBe('completed');
    expect(moveNear).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(Vec3),
      3,
      expect.anything(),
    );
    expect(bot.dig).toHaveBeenCalledWith(target);
  });

  it('fails out_of_reach when the cell is still out of reach after the walk, and digs nothing', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(false);
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'out_of_reach' });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('fails without digging when the walk to the cell fails', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(false);
    vi.mocked(moveNear).mockResolvedValueOnce(walkFailed('blocked'));
    const outcome = await breakCell(bot);
    expect(outcome.status).toBe('failed');
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('is cancelled, not failed, when the walk is cancelled', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(false);
    vi.mocked(moveNear).mockResolvedValueOnce(walkFailed('cancelled'));
    const outcome = await breakCell(bot);
    expect(outcome.status).toBe('cancelled');
    expect(bot.dig).not.toHaveBeenCalled();
    expect(bot.stopDigging).toHaveBeenCalled();
  });

  it('is cancelled when the signal aborts during the dig', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(true);
    const controller = new AbortController();
    bot.dig.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('digging aborted');
    });
    const outcome = await breakCell(bot, CELL, controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(bot.stopDigging).toHaveBeenCalled();
  });

  it('fails not_possible when the cell is not loaded, and walks nothing', async () => {
    const bot = fakeBot([]);
    const outcome = await breakCell(bot, { x: 5, y: 64, z: 5 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('fails not_found when the cell is air', async () => {
    const air = block(0, new Vec3(1, 64, 0), []);
    const bot = fakeBot([air]);
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('fails invalid_args for a cell that is not whole block numbers', async () => {
    const bot = fakeBot([]);
    const outcome = await breakCell(bot, { x: 1.5, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('fails no_effect when the dig reports success but the cell still holds a block', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockImplementationOnce(async () => undefined);
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_effect' });
  });

  it('maps a dig that Mineflayer refuses as infinite time to not_possible', async () => {
    const target = block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG]);
    const bot = fakeBot([target]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockRejectedValueOnce(new Error('Infinity'));
    const outcome = await breakCell(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
  });
});
