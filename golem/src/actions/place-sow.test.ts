import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { placeAction, SEED_CROPS } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** Bounding box of each block the fake knows: `empty` cells are passable, `block` cells are solid. */
const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  wheat: 'empty',
  carrots: 'empty',
  dirt: 'block',
  grass_block: 'block',
  farmland: 'block',
};

interface FakeOptions {
  /** Cells that hold something, by `x,y,z`; every other cell is air. */
  blocks?: Record<string, string>;
  /** Item names in the inventory. */
  items?: string[];
  /** The name written to the target on a placement; defaults to the held item. */
  placedAs?: string;
  /** Thrown by `placeBlock` instead of placing. */
  placeError?: string;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot standing at (0.5, 64, 0.5) with a world map, an inventory and the calls a planting makes. */
function fakeBot(options: FakeOptions = {}) {
  const world = new Map(Object.entries(options.blocks ?? {}));
  let held: { name: string; count: number } | null = null;
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0 },
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
    setControlState: vi.fn(),
    lookAt: vi.fn(async () => undefined),
    waitForTicks: vi.fn(async () => undefined),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: BOXES[name] ?? 'block', shapes: [] };
    },
    placeBlock: vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
      if (options.placeError) throw new Error(options.placeError);
      world.set(key(reference.position.plus(face)), options.placedAs ?? held?.name ?? 'air');
    }),
  };
  return { bot: bot as unknown as Bot, mock: bot, world };
}

/** Runs the `place` handler for a block at a position. */
function place(bot: Bot, block: string, at: { x: number; y: number; z: number } | 'feet') {
  return placeAction.run(
    { bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block, at },
  );
}

const FARMLAND = { '0,63,0': 'farmland' };

describe('seed items', () => {
  it('maps each seed item to the crop block it plants', () => {
    expect(Object.fromEntries(SEED_CROPS)).toEqual({
      wheat_seeds: 'wheat',
      beetroot_seeds: 'beetroots',
      carrot: 'carrots',
      potato: 'potatoes',
      pumpkin_seeds: 'pumpkin_stem',
      melon_seeds: 'melon_stem',
      torchflower_seeds: 'torchflower_crop',
      pitcher_pod: 'pitcher_crop',
    });
  });

  it('leaves nether wart out: it needs soul sand', () => {
    expect(SEED_CROPS.has('nether_wart')).toBe(false);
  });

  it('plants wheat_seeds on farmland: the click goes on the top face and the wheat appears', async () => {
    const { bot, mock, world } = fakeBot({
      blocks: FARMLAND,
      items: ['wheat_seeds'],
      placedAs: 'wheat',
    });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'completed', detail: { block: 'wheat' } });
    expect(world.get('0,64,0')).toBe('wheat');
    expect(mock.placeBlock).toHaveBeenCalledTimes(1);
    const [reference, face] = mock.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position.equals(new Vec3(0, 63, 0))).toBe(true);
    expect(face.equals(new Vec3(0, 1, 0))).toBe(true);
  });

  it('looks at the farmland top face before the click', async () => {
    const { bot, mock } = fakeBot({ blocks: FARMLAND, items: ['wheat_seeds'], placedAs: 'wheat' });
    await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    const look = mock.lookAt.mock.invocationCallOrder[0] ?? Number.NaN;
    const click = mock.placeBlock.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(look).toBeLessThan(click);
    const [point] = mock.lookAt.mock.calls[0] as unknown as [Vec3, boolean];
    expect(point.equals(new Vec3(0.5, 64, 0.5))).toBe(true);
  });

  it('refuses wheat_seeds above grass: seeds need farmland below', async () => {
    const { bot, mock } = fakeBot({ blocks: { '0,63,0': 'grass_block' }, items: ['wheat_seeds'] });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'seeds need farmland below',
    });
    expect(mock.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a seed when the target cell is not air: target is occupied', async () => {
    const { bot, mock } = fakeBot({
      blocks: { ...FARMLAND, '0,64,0': 'wheat' },
      items: ['wheat_seeds'],
    });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target is occupied',
    });
    expect(mock.placeBlock).not.toHaveBeenCalled();
  });

  it('plants carrot as carrots', async () => {
    const { bot, world } = fakeBot({ blocks: FARMLAND, items: ['carrot'], placedAs: 'carrots' });
    const outcome = await place(bot, 'carrot', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'completed', detail: { block: 'carrots' } });
    expect(world.get('0,64,0')).toBe('carrots');
  });

  it('reports a planting the crop block does not appear in', async () => {
    const { bot } = fakeBot({ blocks: FARMLAND, items: ['wheat_seeds'], placedAs: 'dirt' });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the block did not appear at the target',
    });
  });

  it('reports a server refusal of the planting as refused', async () => {
    const { bot } = fakeBot({
      blocks: FARMLAND,
      items: ['wheat_seeds'],
      placeError: 'server refused to place',
    });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the server refused the placement',
    });
  });

  it('reports a planting the server did not answer as a timeout', async () => {
    const { bot } = fakeBot({
      blocks: FARMLAND,
      items: ['wheat_seeds'],
      placeError: 'the server did not answer the placement',
    });
    const outcome = await place(bot, 'wheat_seeds', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message: 'the server did not answer the placement',
    });
  });

  it('keeps the "is not a block" text for an item that is not a seed', async () => {
    const { bot, mock } = fakeBot({ blocks: FARMLAND, items: ['stick'] });
    const outcome = await place(bot, 'stick', { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'stick is not a block',
    });
    expect(mock.placeBlock).not.toHaveBeenCalled();
  });
});
