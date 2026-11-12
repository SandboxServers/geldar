import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { block, COBBLESTONE, type FakeBlock, fakeBot, mine, OAK_LOG, STONE } from './mine.fakes.ts';
import { ensurePathfinder, moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

describe('mineAction drops', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
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
      detail: {
        mined: 1,
        collected: { cobblestone: 1 },
        hint: expect.stringContaining('the space is open'),
      },
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
      detail: {
        mined: 3,
        collected: { oak_log: 1 },
        hint: expect.stringContaining('the space is open'),
      },
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
      detail: {
        mined: 2,
        collected: { oak_log: 8 },
        hint: expect.stringContaining('the space is open'),
      },
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
