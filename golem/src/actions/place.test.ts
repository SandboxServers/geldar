import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { confirmsPlacement, pickReference, placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** Bounding box of each block the fake knows: `empty` cells are passable, `block` cells are solid. */
const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  cave_air: 'empty',
  water: 'empty',
  torch: 'empty',
  wall_torch: 'empty',
  stone: 'block',
  dirt: 'block',
};

interface FakeOptions {
  /** Cells that hold something, by `x,y,z`; every other cell is air. */
  blocks?: Record<string, string>;
  /** Item names in the inventory. */
  items?: string[];
  /** Where the bot stands. */
  at?: Vec3;
  /** The name written to the target on a placement; defaults to the held item. */
  placedAs?: string;
  /** Thrown by `placeBlock` instead of placing. */
  placeError?: string;
}

interface FakeBot {
  bot: Bot;
  placeBlock: ReturnType<typeof vi.fn>;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot with a world map, an inventory and the placement calls `place` makes. */
function fakeBot(options: FakeOptions = {}): FakeBot {
  const world = new Map(Object.entries(options.blocks ?? {}));
  let held: { name: string; count: number } | null = null;
  const bot = {
    entity: { position: options.at ?? new Vec3(0.5, 64, 0.5) },
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
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: BOXES[name] };
    },
    placeBlock: vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
      if (options.placeError) throw new Error(options.placeError);
      world.set(key(reference.position.plus(face)), options.placedAs ?? held?.name ?? 'air');
    }),
  };
  return { bot: bot as unknown as Bot, placeBlock: bot.placeBlock };
}

/** Runs the `place` handler with a fresh abort signal. */
function place(fake: FakeBot, block: string, at: { x: number; y: number; z: number } | 'feet') {
  return placeAction.run(
    { bot: fake.bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block, at },
  );
}

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
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

  it('refuses a colliding block at feet as inside the bot', async () => {
    const fake = fakeBot({ blocks: { '0,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', 'feet');
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target is inside the bot',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a target that is inside the bot body', async () => {
    const fake = fakeBot({ blocks: { '0,63,0': 'stone', '0,65,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target is inside the bot',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a target that is occupied', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone', '2,64,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target occupied',
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

  it('walks within reach before placing', async () => {
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(moveNear).toHaveBeenCalledWith(
      fake.bot,
      new Vec3(10, 64, 0),
      3,
      expect.objectContaining({ timeScale: 1 }),
    );
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

  it('fails as blocked when the placed block is not confirmed', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone' }, items: ['dirt'], placedAs: 'air' });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
  });

  it('fails as blocked when there is nothing solid to place against', async () => {
    const fake = fakeBot({ items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'nothing to place against',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('maps a placement timeout to timeout', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Bot did not answer the placement',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('maps a refused placement to blocked', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Server refused to place dirt',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
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
