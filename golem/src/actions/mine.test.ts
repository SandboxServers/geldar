import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ItemStack, inventoryDelta, mineAction } from './mine.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

interface FakeBlock {
  type: number;
  position: Vec3;
  drops: number[];
  harvestTools: Record<number, boolean> | undefined;
  canHarvest(tool: number | null): boolean;
}

/** A block of `type` at `at`. It can be harvested bare-handed unless `harvestTools` says otherwise. */
function block(
  type: number,
  at: Vec3,
  drops: number[],
  harvestTools?: Record<number, boolean>,
): FakeBlock {
  return {
    type,
    position: at,
    drops,
    harvestTools,
    canHarvest: (tool) => !harvestTools || (tool !== null && harvestTools[tool] === true),
  };
}

const OAK_LOG = 17;
const STONE = 1;
const COBBLESTONE = 4;

/**
 * A fake bot with the parts `mine` reads. Digging clears the block and adds its drops to the
 * inventory at once, unless a test replaces `dig`.
 */
function fakeBot(blocks: FakeBlock[], inventory: ItemStack[] = []) {
  const names: Record<number, string> = {
    [COBBLESTONE]: 'cobblestone',
    [OAK_LOG]: 'oak_log',
    270: 'wooden_pickaxe',
  };
  return {
    entity: { position: new Vec3(0, 64, 0) },
    time: { age: 0 },
    registry: {
      blocksByName: { oak_log: { id: OAK_LOG }, stone: { id: STONE } },
      items: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])),
    },
    inventory: { items: () => inventory },
    findBlocks: vi.fn(
      ({ matching, count }: { matching: (b: FakeBlock) => boolean; count: number }) =>
        blocks
          .filter((b) => matching(b))
          .slice(0, count)
          .map((b) => b.position),
    ),
    blockAt: vi.fn((at: Vec3) => blocks.find((b) => b.position.equals(at)) ?? null),
    pathfinder: {
      bestHarvestTool: vi.fn((): null => null),
      stop: vi.fn(),
      setGoal: vi.fn(),
    },
    equip: vi.fn(async () => undefined),
    stopDigging: vi.fn(),
    waitForTicks: vi.fn(async () => undefined),
    dig: vi.fn(async (target: FakeBlock) => {
      target.type = 0;
      for (const id of target.drops) inventory.push({ name: names[id] ?? '?', count: 1 });
    }),
  };
}

type Fake = ReturnType<typeof fakeBot>;

function ctxFor(bot: Fake, signal = new AbortController().signal): ActionContext {
  return { bot: bot as unknown as Bot, signal, timeScale: 1 };
}

function mine(bot: Fake, count: number, name = 'oak_log', signal?: AbortSignal) {
  return mineAction.run(ctxFor(bot, signal), { do: 'mine', block: name, count });
}

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

  it('returns missing_materials and never digs when the bare hand cannot harvest', async () => {
    const stone = block(STONE, new Vec3(3, 64, 0), [COBBLESTONE], { 270: true });
    const bot = fakeBot([stone]);
    const outcome = await mine(bot, 1, 'stone');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'missing_materials' });
    expect(outcome).toMatchObject({ message: 'needs wooden_pickaxe' });
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
      detail: { mined: 2, collected: { oak_log: 2 } },
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

  it('calls dig once and cancels when the signal aborts between two blocks', async () => {
    const logs = [
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(3, 64, 0), [OAK_LOG]),
    ];
    const controller = new AbortController();
    const bot = fakeBot(logs);
    bot.dig.mockImplementationOnce(async (target: FakeBlock) => {
      target.type = 0;
      controller.abort();
    });
    const outcome = await mine(bot, 2, 'oak_log', controller.signal);
    expect(outcome).toEqual({ status: 'cancelled', detail: { mined: 1 } });
    expect(bot.dig).toHaveBeenCalledTimes(1);
    expect(bot.stopDigging).toHaveBeenCalled();
    expect(bot.pathfinder.stop).toHaveBeenCalled();
  });

  it('stops a dig that is still running when the signal aborts', async () => {
    const controller = new AbortController();
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    // The dig only ends when `stopDigging` is called, as mineflayer does; without the listener this hangs.
    let release: () => void = () => {};
    bot.stopDigging.mockImplementation(() => release());
    bot.dig.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          controller.abort();
        }),
    );
    const outcome = await mine(bot, 1, 'oak_log', controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(bot.stopDigging).toHaveBeenCalled();
  });

  it('polls the drop once per tick and stops when it arrives on the third poll', async () => {
    const bot = fakeBot([block(STONE, new Vec3(2, 64, 0), [COBBLESTONE])]);
    // The dig clears the block but gives nothing; the drop lands during the third wait.
    bot.dig.mockImplementationOnce(async (target: FakeBlock) => {
      target.type = 0;
    });
    bot.waitForTicks.mockImplementation(async () => {
      if (bot.waitForTicks.mock.calls.length === 3) {
        bot.inventory.items().push({ name: 'cobblestone', count: 1 });
      }
    });
    const outcome = await mine(bot, 1, 'stone');
    expect(outcome).toEqual({
      status: 'completed',
      detail: { mined: 1, collected: { cobblestone: 1 } },
    });
    expect(bot.waitForTicks).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['Digging aborted', 'interrupted'],
    ['Infinity', 'not_possible'],
    ['Block is not in view', 'blocked'],
    ['boom', 'internal'],
  ] as const)('maps a dig rejection of "%s" to %s', async (message, reason) => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.dig.mockRejectedValueOnce(new Error(message));
    expect(await mine(bot, 1)).toMatchObject({ status: 'failed', reason, detail: { mined: 0 } });
  });
});
