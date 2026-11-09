import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ItemStack, inventoryDelta, mineAction } from './mine.ts';
import { ensurePathfinder, moveNear } from './pathing.ts';
import type { ActionContext } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

interface FakeBlock {
  type: number;
  position: Vec3;
  drops: number[];
  harvestTools: Record<number, boolean> | undefined;
  canHarvest(tool: number | null): boolean;
  /** `'empty'` for air: a drop falls through it. Solid blocks leave it unset. */
  boundingBox?: 'empty';
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
    /** Item entities in view; a test adds a drop here to steer the pickup walk. */
    entities: {} as Record<number, { name: string; position: Vec3 }>,
    time: { age: 0 },
    registry: {
      blocksByName: { oak_log: { id: OAK_LOG }, stone: { id: STONE } },
      items: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])),
    },
    inventory: { items: () => inventory },
    // As in Mineflayer, the matcher first sees each block type with a null position (the palette
    // probe), then every cell with its position.
    findBlocks: vi.fn(
      ({ matching, count }: { matching: (b: FakeBlock) => boolean; count: number }) => {
        for (const b of blocks) matching({ ...b, position: null } as unknown as FakeBlock);
        return blocks
          .filter((b) => matching(b))
          .slice(0, count)
          .map((b) => b.position);
      },
    ),
    blockAt: vi.fn((at: Vec3) => blocks.find((b) => b.position.equals(at)) ?? null),
    /** Within Mineflayer's dig reach; a test sets this to true to skip the walk. */
    canDigBlock: vi.fn((_target: FakeBlock | null): boolean => false),
    pathfinder: {
      bestHarvestTool: vi.fn((): null => null),
      stop: vi.fn(),
      setGoal: vi.fn(),
    },
    equip: vi.fn(async () => undefined),
    stopDigging: vi.fn(),
    waitForTicks: vi.fn(async (_ticks: number) => undefined),
    lookAt: vi.fn(async (_at: Vec3) => undefined),
    setControlState: vi.fn(),
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
      detail: { mined: 1, collected: { oak_log: 1 } },
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

  it('walks the drop to the lowest air cell under the broken block', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      { ...block(0, new Vec3(2, 63, 0), []), boundingBox: 'empty' },
    ]);
    bot.canDigBlock.mockReturnValue(true);
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    // With the reach walk skipped, the only walk is the pickup, to the air cell below.
    expect(vi.mocked(moveNear).mock.calls).toHaveLength(1);
    expect(vi.mocked(moveNear).mock.calls[0]?.[1]).toEqual(new Vec3(2, 63, 0));
    expect(vi.mocked(moveNear).mock.calls[0]?.[2]).toBe(0);
  });

  it('does not dig a cell twice: a cell already tried is left out of the next search', async () => {
    // The first dig reports success but leaves the log in place, so the cell is still wanted.
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(3, 64, 0), [OAK_LOG]),
    ]);
    bot.canDigBlock.mockReturnValue(true);
    bot.dig.mockImplementationOnce(async () => undefined);
    expect(await mine(bot, 2)).toMatchObject({ status: 'completed', detail: { mined: 2 } });
    expect(bot.dig.mock.calls.map(([target]) => target.position)).toEqual([
      new Vec3(2, 64, 0),
      new Vec3(3, 64, 0),
    ]);
  });

  it('completes when the walk to a drop fails, because the wait and the inventory decide', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    vi.mocked(moveNear)
      .mockResolvedValueOnce({ ok: true, distance: 0 })
      .mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'no path' });
    const outcome = await mine(bot, 1);
    expect(outcome.status).toBe('completed');
    expect(outcome.detail.mined).toBe(1);
  });

  it('ensures the pathfinder before the action reads or stops it', async () => {
    const bot = fakeBot([]);
    await mine(bot, 1);
    expect(ensurePathfinder).toHaveBeenCalledWith(bot);
  });

  it('retries the drop walk from a neighbour cell when the drop cell cannot be reached', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      { ...block(0, new Vec3(2, 63, 0), []), boundingBox: 'empty' },
    ]);
    bot.canDigBlock.mockReturnValue(true);
    // The drop cell has a block above it: the first walk to it fails.
    vi.mocked(moveNear).mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'no path' });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear).mock.calls.map(([, target]) => target)).toEqual([
      new Vec3(2, 63, 0),
      new Vec3(3, 63, 0),
    ]);
  });

  it('aims the drop walk at the neighbour nearest the item entity first', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      { ...block(0, new Vec3(2, 63, 0), []), boundingBox: 'empty' },
    ]);
    bot.canDigBlock.mockReturnValue(true);
    // The item lies just east of the drop cell, so the walk goes to the cell east of it first.
    bot.entities[1] = { name: 'item', position: new Vec3(3.2, 63.2, 0.5) };
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear).mock.calls[0]?.[1]).toEqual(new Vec3(3, 63, 0));
  });

  it('walks onto the cell of a drop that landed outside the pickup box', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      { ...block(0, new Vec3(2, 63, 0), []), boundingBox: 'empty' },
    ]);
    bot.canDigBlock.mockReturnValue(true);
    // The item landed 4.2 blocks east: 2.8 from the bot, out of reach of the walk to the drop cell.
    bot.entities[1] = { name: 'item', position: new Vec3(4.2, 63, 0.5) };
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear).mock.calls[1]?.[1]).toEqual(new Vec3(4, 63, 0));
  });

  it('finds a drop that fell five cells below the broken block', async () => {
    const air = [63, 62, 61, 60, 59].map((y) => ({
      ...block(0, new Vec3(2, y, 0), []),
      boundingBox: 'empty' as const,
    }));
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]), ...air]);
    bot.canDigBlock.mockReturnValue(true);
    // 4.5 blocks from the broken block's corner, but in the cell the drop falls to.
    bot.entities[1] = { name: 'item', position: new Vec3(2.5, 59.5, 0.5) };
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear).mock.calls[1]?.[1]).toEqual(new Vec3(2, 59, 0));
  });

  it('neither walks nor nudges when the drop is already inside the pickup box', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    // 1.2 blocks east of the bot, at its height: the item box meets the grown player box.
    bot.entities[1] = { name: 'item', position: new Vec3(1.2, 64, 0.5) };
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear)).toHaveBeenCalledTimes(1);
    expect(bot.setControlState).not.toHaveBeenCalled();
  });

  it('walks straight at a drop the path cannot reach, until it is inside the pickup box', async () => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    bot.canDigBlock.mockReturnValue(true);
    // 2.0 blocks east of the bot: out of the box. Each forward tick moves the bot 0.25 east, so
    // the five nudge ticks bring it to 1.25, 0.75 blocks from the item.
    bot.entities[1] = { name: 'item', position: new Vec3(2, 64, 0.5) };
    let forward = false;
    bot.setControlState.mockImplementation((control: string, on: boolean) => {
      if (control === 'forward') forward = on;
    });
    bot.waitForTicks.mockImplementation(async (ticks: number) => {
      if (forward) bot.entity.position = bot.entity.position.offset(0.25 * ticks, 0, 0);
    });
    expect(await mine(bot, 1)).toMatchObject({ status: 'completed' });
    expect(bot.lookAt).toHaveBeenCalledWith(new Vec3(2, 64, 0.5));
    expect(bot.setControlState.mock.calls).toEqual([
      ['forward', true],
      ['forward', false],
    ]);
    // The initial walk, then the walk to the item's cell; the second round finds the box reached.
    expect(vi.mocked(moveNear)).toHaveBeenCalledTimes(2);
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

  it('does not end the wait for block 3 on a drop that lands during it from an earlier block', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(3, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(4, 64, 0), [OAK_LOG]),
    ]);
    // Digging clears each block and gives nothing; the only drop is block 1's, which lands on
    // the 121st wait: after block 2's waits, during block 3's first poll window.
    bot.dig.mockImplementation(async (target: FakeBlock) => {
      target.type = 0;
    });
    bot.waitForTicks.mockImplementation(async () => {
      if (bot.waitForTicks.mock.calls.length === 121) {
        bot.inventory.items().push({ name: 'oak_log', count: 1 });
      }
    });
    const outcome = await mine(bot, 3);
    expect(outcome).toEqual({
      status: 'completed',
      detail: { mined: 3, collected: { oak_log: 1 } },
    });
    // Each of the three waits runs its full 60 polls: one late drop is not three drops.
    expect(bot.waitForTicks).toHaveBeenCalledTimes(180);
  });

  it('waits for the second block of a multi-drop kind until its own drop arrives', async () => {
    const bot = fakeBot([
      block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG]),
      block(OAK_LOG, new Vec3(3, 64, 0), [OAK_LOG]),
    ]);
    // Digging clears the block and gives nothing. Block 1 drops 4 on the first poll; block 2 drops
    // 4 on its third poll. Block 2's wait must not end on block 1's 4 (4 >= mined 2).
    bot.dig.mockImplementation(async (target: FakeBlock) => {
      target.type = 0;
    });
    bot.waitForTicks.mockImplementation(async () => {
      const calls = bot.waitForTicks.mock.calls.length;
      if (calls === 1 || calls === 4) {
        for (let i = 0; i < 4; i++) bot.inventory.items().push({ name: 'oak_log', count: 1 });
      }
    });
    const outcome = await mine(bot, 2);
    expect(outcome).toEqual({
      status: 'completed',
      detail: { mined: 2, collected: { oak_log: 8 } },
    });
    expect(bot.waitForTicks).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['Digging aborted', 'interrupted'],
    ['Infinity', 'not_possible'],
    ['Block is not in view', 'blocked'],
    ['boom', 'internal'],
  ] as const)('maps a dig rejection of "%s" to %s', async (message, reason) => {
    const bot = fakeBot([block(OAK_LOG, new Vec3(2, 64, 0), [OAK_LOG])]);
    // Persistent, so a "not in view" rejection is still there after the one retry.
    bot.dig.mockRejectedValue(new Error(message));
    expect(await mine(bot, 1)).toMatchObject({ status: 'failed', reason, detail: { mined: 0 } });
  });
});
