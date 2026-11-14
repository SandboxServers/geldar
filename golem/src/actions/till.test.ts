import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordOwnPlacement } from './own-placements.ts';
import { type OwnerAnswer, setOwnerLookup } from './protected-blocks.ts';
import { tillAction } from './till.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** Bounding box of each block the fake knows: `empty` cells are passable, `block` cells are solid. */
const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  grass_block: 'block',
  dirt: 'block',
  dirt_path: 'block',
  coarse_dirt: 'block',
  rooted_dirt: 'block',
  farmland: 'block',
  stone: 'block',
};

interface FakeOptions {
  /** Cells that hold something, by `x,y,z`; every other cell is air. */
  blocks?: Record<string, string>;
  /** Cells the bot has not loaded, by `x,y,z`. */
  unloaded?: string[];
  /** Item names in the inventory. */
  items?: string[];
  /** The block the world holds after the hoe is used; unset means the use changes nothing. */
  tilledAs?: string;
  /** Where the bot stands. */
  at?: Vec3;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot with a world map, an inventory, and the calls a tilling makes. `order` logs look and click. */
function fakeBot(options: FakeOptions = {}) {
  const world = new Map(Object.entries(options.blocks ?? {}));
  const unloaded = new Set(options.unloaded ?? []);
  const order: string[] = [];
  let held: { name: string; count: number } | null = null;
  const bot = {
    username: 'ag_self_01',
    entity: { position: options.at ?? new Vec3(0.5, 64, 0.5), yaw: 0 },
    entities: {},
    get heldItem() {
      return held;
    },
    registry: {
      blocksByName: Object.fromEntries(
        Object.entries(BOXES).map(([name, boundingBox]) => [name, { boundingBox }]),
      ),
    },
    inventory: { items: () => (options.items ?? []).map((name) => ({ name, count: 1 })) },
    equip: vi.fn(async (stack: { name: string; count: number }) => {
      held = stack;
    }),
    lookAt: vi.fn(async () => {
      order.push('look');
    }),
    waitForTicks: vi.fn(async () => undefined),
    activateBlock: vi.fn(async (block: { position: Vec3 }, ..._direction: Vec3[]) => {
      order.push('activate');
      if (options.tilledAs !== undefined) world.set(key(block.position), options.tilledAs);
    }),
    blockAt: (p: Vec3) => {
      if (unloaded.has(key(p))) return null;
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: BOXES[name] ?? 'empty', shapes: [] };
    },
  };
  return { bot: bot as unknown as Bot, fake: bot, order };
}

/** Runs the `till` handler with a fresh abort signal. */
function till(bot: Bot, at = { x: 2, y: 63, z: 2 }, signal = new AbortController().signal) {
  return tillAction.run({ bot, signal, timeScale: 1 }, { do: 'till', at });
}

/** A grass block at (2,63,2) with air above, the common case. */
const GRASS = { '2,63,2': 'grass_block' };

afterEach(() => {
  setOwnerLookup(null);
});

describe('till: the hoe', () => {
  it('says there is no hoe when none is in the inventory', async () => {
    const { bot } = fakeBot({ blocks: GRASS, items: ['wooden_sword'] });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      message: 'no hoe in the inventory',
    });
  });

  it('equips the best hoe in the inventory when it is not held', async () => {
    const { bot, fake } = fakeBot({
      blocks: GRASS,
      items: ['wooden_hoe', 'iron_hoe', 'stone_hoe'],
      tilledAs: 'farmland',
    });
    await till(bot);
    expect(fake.equip).toHaveBeenCalledWith({ name: 'iron_hoe', count: 1 }, 'hand');
  });
});

describe('till: the target', () => {
  it('turns grass_block with air above into farmland and completes with that block', async () => {
    const { bot } = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    expect(await till(bot)).toEqual({
      status: 'completed',
      detail: { block: 'farmland', at: { x: 2, y: 63, z: 2 } },
    });
  });

  it('turns dirt_path into farmland', async () => {
    const { bot } = fakeBot({
      blocks: { '2,63,2': 'dirt_path' },
      items: ['wooden_hoe'],
      tilledAs: 'farmland',
    });
    expect(await till(bot)).toMatchObject({ status: 'completed', detail: { block: 'farmland' } });
  });

  it('turns coarse_dirt into dirt', async () => {
    const { bot } = fakeBot({
      blocks: { '2,63,2': 'coarse_dirt' },
      items: ['wooden_hoe'],
      tilledAs: 'dirt',
    });
    expect(await till(bot)).toMatchObject({ status: 'completed', detail: { block: 'dirt' } });
  });

  it('turns rooted_dirt into dirt', async () => {
    const { bot } = fakeBot({
      blocks: { '2,63,2': 'rooted_dirt' },
      items: ['wooden_hoe'],
      tilledAs: 'dirt',
    });
    expect(await till(bot)).toMatchObject({ status: 'completed', detail: { block: 'dirt' } });
  });

  it('says a stone block cannot be tilled', async () => {
    const { bot } = fakeBot({ blocks: { '2,63,2': 'stone' }, items: ['wooden_hoe'] });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'that block cannot be tilled',
    });
  });

  it('says the target is not loaded when its cell is unknown', async () => {
    const { bot } = fakeBot({ blocks: GRASS, unloaded: ['2,63,2'], items: ['wooden_hoe'] });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'target is not loaded',
    });
  });

  it('says the block above is not clear when a block sits on it', async () => {
    const { bot, fake } = fakeBot({
      blocks: { ...GRASS, '2,64,2': 'stone' },
      items: ['wooden_hoe'],
      tilledAs: 'farmland',
    });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'the block above is not clear',
    });
    expect(fake.activateBlock).not.toHaveBeenCalled();
  });

  it('refuses a target out of reach after the walk leaves it there', async () => {
    const { bot, fake } = fakeBot({
      blocks: { '20,63,20': 'grass_block' },
      items: ['wooden_hoe'],
      tilledAs: 'farmland',
    });
    expect(await till(bot, { x: 20, y: 63, z: 20 })).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the target is out of reach',
    });
    expect(fake.activateBlock).not.toHaveBeenCalled();
  });
});

describe('till: ownership (decision 0164)', () => {
  it('refuses a block another player recorded as theirs', async () => {
    setOwnerLookup((): OwnerAnswer => ({ known: true, owner: 'ag_other_01' }));
    const { bot, fake } = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: "that block is someone else's work",
    });
    expect(fake.activateBlock).not.toHaveBeenCalled();
  });

  it('allows a block the bot placed itself, even when the record names another player', async () => {
    setOwnerLookup((): OwnerAnswer => ({ known: true, owner: 'ag_other_01' }));
    const { bot } = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    recordOwnPlacement(bot, { x: 2, y: 63, z: 2 }, 'grass_block');
    expect(await till(bot)).toMatchObject({ status: 'completed' });
  });

  it('allows a block with no record, and one the record gives to the bot', async () => {
    setOwnerLookup((): OwnerAnswer => ({ known: false }));
    const unknown = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    expect(await till(unknown.bot)).toMatchObject({ status: 'completed' });
    setOwnerLookup((): OwnerAnswer => ({ known: true, owner: null }));
    const natural = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    expect(await till(natural.bot)).toMatchObject({ status: 'completed' });
  });
});

describe('till: the use', () => {
  it('sends the look at the top face before the click, then waits two ticks', async () => {
    const { bot, fake, order } = fakeBot({
      blocks: GRASS,
      items: ['wooden_hoe'],
      tilledAs: 'farmland',
    });
    await till(bot);
    expect(order).toEqual(['look', 'activate']);
    expect(fake.lookAt).toHaveBeenCalledWith(new Vec3(2.5, 64, 2.5), true);
    expect(fake.waitForTicks).toHaveBeenCalledWith(2);
    expect(fake.activateBlock.mock.calls[0]?.[1]).toEqual(new Vec3(0, 1, 0));
  });

  it('says no_effect when the block does not change after the use', async () => {
    const { bot } = fakeBot({ blocks: GRASS, items: ['wooden_hoe'] });
    expect(await till(bot)).toMatchObject({
      status: 'failed',
      reason: 'no_effect',
      message: 'the block did not change',
    });
  });

  it('stops without clicking when the signal aborts before the look', async () => {
    const controller = new AbortController();
    controller.abort();
    const { bot, fake } = fakeBot({ blocks: GRASS, items: ['wooden_hoe'], tilledAs: 'farmland' });
    expect(await till(bot, { x: 2, y: 63, z: 2 }, controller.signal)).toMatchObject({
      status: 'cancelled',
    });
    expect(fake.activateBlock).not.toHaveBeenCalled();
  });
});
