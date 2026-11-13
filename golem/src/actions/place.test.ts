import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { block, type FakeBlock, type Scene, scriptedBot } from './escape-ladder.fakes.ts';
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
  dirt_path: 'block',
  cobblestone: 'block',
  crafting_table: 'block',
  white_bed: 'block',
};

const SHAPES: Record<string, number[][]> = { dirt_path: [[0, 0, 0, 1, 0.9375, 1]] };

interface FakeOptions {
  /** Cells that hold something, by `x,y,z`; every other cell is air. */
  blocks?: Record<string, string>;
  /** Item names in the inventory. */
  items?: string[];
  /** Where the bot stands. */
  at?: Vec3;
  /** Where the bot faces, in radians (0 faces +z). */
  yaw?: number;
  /** Other entities, each standing at the position given. */
  entities?: Vec3[];
  /** The name written to the target on a placement; defaults to the held item. */
  placedAs?: string;
  /** Thrown by `placeBlock` instead of placing. */
  placeError?: string;
  /** The first N placements are refused by the server, the later ones work. */
  refuseFirst?: number;
}

interface FakeBot {
  bot: Bot;
  placeBlock: ReturnType<typeof vi.fn>;
  look: ReturnType<typeof vi.fn>;
  setControlState: ReturnType<typeof vi.fn>;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot with a world map, an inventory and the placement calls `place` makes. */
function fakeBot(options: FakeOptions = {}): FakeBot {
  const world = new Map(Object.entries(options.blocks ?? {}));
  let held: { name: string; count: number } | null = null;
  let attempts = 0;
  const bot = {
    entity: { position: options.at ?? new Vec3(0.5, 64, 0.5), yaw: options.yaw ?? 0 },
    entities: Object.fromEntries(
      (options.entities ?? []).map((position, i) => [String(i + 1), { position }]),
    ),
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
    look: vi.fn(async () => undefined),
    setControlState: vi.fn(),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: BOXES[name], shapes: SHAPES[name] ?? [] };
    },
    placeBlock: vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
      if (options.placeError) throw new Error(options.placeError);
      if (attempts++ < (options.refuseFirst ?? 0)) throw new Error('server refused to place');
      world.set(key(reference.position.plus(face)), options.placedAs ?? held?.name ?? 'air');
    }),
  };
  return {
    bot: bot as unknown as Bot,
    placeBlock: bot.placeBlock,
    look: bot.look,
    setControlState: bot.setControlState,
  };
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
  // A walk that completes leaves the bot within its range of the target, on the x axis, as the real walk does.
  vi.mocked(moveNear).mockImplementation(async (bot, target, range) => {
    if (bot.entity.position.distanceTo(target) > range) {
      bot.entity.position = new Vec3(target.x + 0.5 - range, target.y, target.z + 0.5);
    }
    return { ok: true, distance: 0 };
  });
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

describe('place into water', () => {
  it('places a block into a water cell beside a solid block', async () => {
    // The bot stands on a single stone block in a pond; the water cell east of it is level with the stone.
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '1,63,0': 'water' },
      items: ['cobblestone'],
    });
    const outcome = await place(fake, 'cobblestone', { x: 1, y: 63, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.placeBlock.mock.calls[0]?.[0].position).toEqual(new Vec3(0, 63, 0));
  });

  it('refuses a water cell with no solid block beside it, without placing', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '1,64,0': 'water' },
      items: ['cobblestone'],
    });
    const outcome = await place(fake, 'cobblestone', { x: 1, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });
});

describe('place reference selection', () => {
  const ground = { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,1': 'stone' };

  it('places a crafting table next to a solid block with the item in hand', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone' },
      items: ['crafting_table'],
    });
    const outcome = await place(fake, 'crafting_table', { x: 0, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.bot.heldItem?.name).toBe('crafting_table');
  });

  it('places dirt at a coordinate against the block below', async () => {
    const fake = fakeBot({ blocks: ground, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 1, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    const [reference, face] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position).toEqual(new Vec3(1, 63, 1));
    expect(face).toEqual(new Vec3(0, 1, 0));
  });

  it('tries the next solid neighbour when the server refuses the first', async () => {
    const fake = fakeBot({
      blocks: { ...ground, '2,64,1': 'stone' },
      items: ['crafting_table'],
      refuseFirst: 1,
    });
    const outcome = await place(fake, 'crafting_table', { x: 1, y: 64, z: 1 });
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(2);
    const [second] = fake.placeBlock.mock.calls[1] as [{ position: Vec3 }];
    expect(second.position).toEqual(new Vec3(2, 64, 1));
  });

  it('fails with the refused text when every neighbour is refused', async () => {
    const fake = fakeBot({ blocks: ground, items: ['dirt'], refuseFirst: 9 });
    const outcome = await place(fake, 'dirt', { x: 1, y: 64, z: 1 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('the server refused'),
    });
  });

  it('stops at the next neighbour when the action is aborted after a refusal', async () => {
    const fake = fakeBot({
      blocks: { ...ground, '2,64,1': 'stone' },
      items: ['dirt'],
      refuseFirst: 1,
    });
    const abort = new AbortController();
    fake.placeBlock.mockImplementationOnce(async () => {
      abort.abort();
      throw new Error('server refused to place');
    });
    const outcome = await placeAction.run(
      { bot: fake.bot, signal: abort.signal, timeScale: 1 },
      { do: 'place', block: 'dirt', at: { x: 1, y: 64, z: 1 } },
    );
    expect(outcome.status).toBe('cancelled');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
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

  it('moves a target at the bot head cell beside the bot too', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone' },
      items: ['dirt'],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome.status).toBe('completed');
    const [reference] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }];
    expect(reference.position).toEqual(new Vec3(0, 63, 1));
  });

  it('skips a neighbor that an entity stands in', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,0': 'stone' },
      items: ['dirt'],
      entities: [new Vec3(0.5, 64, 1.5)],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome.status).toBe('completed');
    const [reference] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }];
    expect(reference.position).toEqual(new Vec3(1, 63, 0));
  });

  it('fails with the no-space message when every neighbor is a solid block', async () => {
    const fake = fakeBot({
      blocks: {
        '0,63,0': 'stone',
        '0,64,1': 'stone',
        '1,64,0': 'stone',
        '-1,64,0': 'stone',
        '0,64,-1': 'stone',
      },
      items: ['dirt'],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no free space next to you',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('fails with the no-space message when every neighbor holds an entity', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '1,63,0': 'stone', '-1,63,0': 'stone' },
      items: ['dirt'],
      entities: [
        new Vec3(0.5, 64, 1.5),
        new Vec3(1.5, 64, 0.5),
        new Vec3(-0.5, 64, 0.5),
        new Vec3(0.5, 64, -0.5),
      ],
    });
    const outcome = await place(fake, 'dirt', { x: 0, y: 65, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no free space next to you',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('places a bed second half one further in the same direction', async () => {
    const fake = fakeBot({
      blocks: { '0,63,0': 'stone', '0,63,1': 'stone', '0,64,2': 'stone', '1,63,0': 'stone' },
      items: ['white_bed'],
    });
    const outcome = await place(fake, 'white_bed', 'feet');
    expect(outcome.status).toBe('completed');
    const [reference, face] = fake.placeBlock.mock.calls[0] as [{ position: Vec3 }, Vec3];
    expect(reference.position).toEqual(new Vec3(1, 63, 0));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.look).toHaveBeenCalledWith(-Math.PI / 2, 0, true);
  });

  it('refuses a target that is occupied', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone', '2,64,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'target is occupied',
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

  it('does not place after a partial walk, and says the target is out of reach', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({ ok: true, partial: true, distance: 6 } as never);
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the target is out of reach',
    });
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

  it('fails as blocked with a what-to-do message when the block does not appear', async () => {
    const fake = fakeBot({ blocks: { '2,63,0': 'stone' }, items: ['dirt'], placedAs: 'air' });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the block did not appear at the target',
    });
  });

  it('fails as blocked with a fixed message when there is nothing solid to place against', async () => {
    const fake = fakeBot({ items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no solid block to place against',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('maps a placement timeout to timeout with a fixed message', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Bot did not answer the placement',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message: 'the server did not answer the placement',
    });
  });

  it('maps a refused placement to blocked with a fixed message', async () => {
    const fake = fakeBot({
      blocks: { '2,63,0': 'stone' },
      items: ['dirt'],
      placeError: 'Server refused to place dirt at (2, 64, 0): the block is still air',
    });
    const outcome = await place(fake, 'dirt', { x: 2, y: 64, z: 0 });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the server refused the placement',
    });
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

it('a block beside a dirt path under the feet is placed, not refused inside a block', async () => {
  const fake = fakeBot({
    blocks: { '0,62,0': 'dirt_path', '1,62,0': 'stone' },
    items: ['cobblestone'],
    at: new Vec3(0.5, 62.9375, 0.5),
  });
  const outcome = await place(fake, 'cobblestone', { x: 1, y: 63, z: 0 });
  expect(outcome).toMatchObject({ status: 'completed' });
  expect(fake.placeBlock).toHaveBeenCalledTimes(1);
});

describe('place at feet as a pillar (decision 0160)', () => {
  /** A bot that jumps on the escape-ladder jump curve; placing puts dirt in the cell it left. */
  function pillarFake(blocks: Record<string, FakeBlock>, onGround = true, placeAt = '0,64,0') {
    const curve = [0.42, 0.753, 1.0, 1.166, 1.249];
    let airTicks = 0;
    const scene: Scene = {
      items: ['dirt'],
      blocks,
      physics: (s) => {
        if (!s.held || !s.controls.jump || fake.bot.placeBlock.mock.calls.length > 0) return;
        s.position.y = 64 + (curve[Math.min(airTicks, curve.length - 1)] ?? 1.249);
        airTicks++;
      },
    };
    const fake = scriptedBot(scene);
    Object.assign(fake.bot.entity, { onGround });
    fake.bot.placeBlock.mockImplementation(async () => {
      scene.blocks = { ...scene.blocks, [placeAt]: block('dirt') };
    });
    return fake;
  }

  const pillar = (fake: ReturnType<typeof pillarFake>, signal = new AbortController().signal) =>
    placeAction.run(
      { bot: fake.asBot, signal, timeScale: 1 },
      { do: 'place', block: 'dirt', at: 'feet' },
    );

  it('places the block in the cell the feet were in, and the bot ends a block higher', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    const [reference, face] = fake.bot.placeBlock.mock.calls[0] as unknown as [unknown, Vec3];
    expect(reference).toEqual(block('stone'));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.state.blockAt(new Vec3(0, 64, 0)).name).toBe('dirt');
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
    expect(fake.bot.dig).not.toHaveBeenCalled();
  });

  it('uses a dirt path under the feet as the ground: the feet cell is above it, so the pillar goes up from it', async () => {
    const fake = pillarFake({
      '0,63,0': { ...block('dirt_path'), shapes: [[0, 0, 0, 1, 0.9375, 1]] },
    });
    fake.state.position.y = 63.9375;
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    const [reference] = fake.bot.placeBlock.mock.calls[0] as unknown as [{ name: string }, Vec3];
    expect(reference.name).toBe('dirt_path');
    expect(fake.state.blockAt(new Vec3(0, 64, 0)).name).toBe('dirt');
  });

  it('refuses with a no-headroom message and places nothing under bedrock two cells above the head', async () => {
    const fake = pillarFake({ '0,63,0': block('stone'), '0,66,0': block('bedrock') });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('no headroom for a pillar'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses when the bot is not on the ground', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') }, false);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('not on the ground'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses when no solid block is under the feet', async () => {
    const fake = pillarFake({});
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('no solid block under your feet'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('fails without placing when the bot never rises high enough', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    fake.bot.waitForTicks.mockImplementation(async () => undefined);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('is cancelled, and places nothing, when the signal aborts mid-jump', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    const abort = new AbortController();
    fake.bot.waitForTicks.mockImplementationOnce(async () => {
      abort.abort();
    });
    const outcome = await pillar(fake, abort.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a pillar when another entity box overlaps the cell the block goes into', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(0.3, 64, 0.3), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'another entity stands where the block goes',
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a pillar when a friend in the next cell reaches into the cell', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(1.1, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('places when a friend stands in the next cell 0.35 from the target face', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(1.65, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('places when a friend only touches the cell face (flush contact is not a collision)', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(-0.3, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('holds the sneak through a placement against a crafting table, and releases it after', async () => {
    const fake = pillarFake({ '0,63,0': block('crafting_table') });
    const held: unknown[] = [];
    fake.bot.placeBlock.mockImplementation(async () => {
      held.push(fake.state.controls.sneak);
    });
    await pillar(fake);
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(held).toEqual([true]);
    expect(fake.state.controls.sneak).toBe(false);
  });

  it('does not sneak for a pillar on plain stone', async () => {
    const fake = pillarFake({ '0,63,0': block('stone') });
    await pillar(fake);
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.bot.setControlState).not.toHaveBeenCalledWith('sneak', expect.anything());
  });

  describe('when the headroom above the feet is unsafe', () => {
    // Stone two cells up with gravel above it: digging the stone would drop the gravel on the bot.
    const unsafe = { '0,66,0': block('stone'), '0,67,0': block('gravel') };

    it('steps to a neighbour whose headroom is clear, and pillars there', async () => {
      const fake = pillarFake(
        { '0,63,0': block('stone'), '1,63,0': block('stone'), ...unsafe },
        true,
        '1,64,0',
      );
      vi.mocked(moveNear).mockClear();
      vi.mocked(moveNear).mockImplementationOnce(async () => {
        fake.state.position.x = 1.5;
        return { ok: true, distance: 0 };
      });
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({ status: 'completed' });
      expect(moveNear).toHaveBeenCalledTimes(1);
      expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
      expect(fake.state.blockAt(new Vec3(1, 64, 0)).name).toBe('dirt');
      expect(fake.bot.dig).not.toHaveBeenCalled();
    });

    it('keeps the headroom refusal, and does not move, when no neighbour has a solid ground', async () => {
      const fake = pillarFake({ '0,63,0': block('stone'), ...unsafe });
      vi.mocked(moveNear).mockClear();
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message: expect.stringContaining('no headroom for a pillar: stone is unsafe to dig'),
      });
      expect(moveNear).not.toHaveBeenCalled();
      expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    });

    it('does not step to a neighbour whose own headroom is unsafe too', async () => {
      const fake = pillarFake({
        '0,63,0': block('stone'),
        '1,63,0': block('stone'),
        '1,66,0': block('stone'),
        '1,67,0': block('gravel'),
        ...unsafe,
      });
      vi.mocked(moveNear).mockClear();
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'blocked',
        message: expect.stringContaining('no headroom for a pillar'),
      });
      expect(moveNear).not.toHaveBeenCalled();
      expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    });
  });
});

describe('placing against a block that opens on use', () => {
  it('holds the sneak while placing against a crafting table, and releases it after', async () => {
    const fake = fakeBot({ blocks: { '10,63,0': 'crafting_table' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(fake.setControlState.mock.calls).toEqual([
      ['sneak', true],
      ['sneak', false],
    ]);
    const [on, off] = fake.setControlState.mock.invocationCallOrder;
    const placed = fake.placeBlock.mock.invocationCallOrder[0] ?? 0;
    expect(on).toBeLessThan(placed);
    expect(placed).toBeLessThan(off ?? 0);
  });

  it('releases the sneak when the placement throws', async () => {
    const fake = fakeBot({
      blocks: { '10,63,0': 'crafting_table' },
      items: ['dirt'],
      placeError: 'socket closed',
    });
    await expect(place(fake, 'dirt', { x: 10, y: 64, z: 0 })).rejects.toThrow('socket closed');
    expect(fake.setControlState.mock.calls).toEqual([
      ['sneak', true],
      ['sneak', false],
    ]);
  });

  it('does not sneak when the reference is plain stone', async () => {
    const fake = fakeBot({ blocks: { '10,63,0': 'stone' }, items: ['dirt'] });
    const outcome = await place(fake, 'dirt', { x: 10, y: 64, z: 0 });
    expect(outcome.status).toBe('completed');
    expect(fake.setControlState).not.toHaveBeenCalled();
  });
});
