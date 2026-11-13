import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** Bounding boxes the fake knows: water and air are passable, stone and cobblestone are solid. */
const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  water: 'empty',
  stone: 'block',
  cobblestone: 'block',
};

/** A bot holding cobblestone at `at`, over the cells in `blocks` (`x,y,z` to name); every other cell is air. */
function fakeBot(at: Vec3, blocks: Record<string, string>) {
  const world = new Map(Object.entries(blocks));
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
  const placeBlock = vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
    world.set(key(reference.position.plus(face)), 'cobblestone');
  });
  const bot = {
    entity: { position: at, yaw: 0 },
    entities: {},
    heldItem: { name: 'cobblestone', count: 1 },
    registry: {
      blocksByName: Object.fromEntries(
        Object.entries(BOXES).map(([n, b]) => [n, { boundingBox: b }]),
      ),
    },
    inventory: { items: () => [{ name: 'cobblestone', count: 1 }] },
    equip: vi.fn(async () => undefined),
    look: vi.fn(async () => undefined),
    setControlState: vi.fn(),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: BOXES[name], shapes: [] };
    },
    placeBlock,
  };
  return { bot: bot as unknown as Bot, placeBlock };
}

/** Runs the `place` handler for cobblestone at the cell given, with a fresh abort signal. */
function placeAt(bot: Bot, x: number, y: number, z: number) {
  return placeAction.run(
    { bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block: 'cobblestone', at: { x, y, z } },
  );
}

describe('place into water', () => {
  it('places a block into a water cell beside a solid block', async () => {
    // The bot stands on a single stone block in a pond; the water cell east of it is level with the stone.
    const fake = fakeBot(new Vec3(0.5, 64, 0.5), { '0,63,0': 'stone', '1,63,0': 'water' });
    const outcome = await placeAt(fake.bot, 1, 63, 0);
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.placeBlock.mock.calls[0]?.[0].position).toEqual(new Vec3(0, 63, 0));
  });

  it('refuses a water cell with no solid block beside it, without placing', async () => {
    const fake = fakeBot(new Vec3(0.5, 64, 0.5), { '0,63,0': 'stone', '1,64,0': 'water' });
    const outcome = await placeAt(fake.bot, 1, 64, 0);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });
});
