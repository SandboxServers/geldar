import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** The target cell: a stone block below it is the reference, and the cell itself is air. */
const TARGET = { x: 10, y: 64, z: 0 };

interface Occupant {
  type: string;
  name?: string;
  position: Vec3;
}

/** A fake bot at (7.5, 64, 0.5), within reach of the target, holding cobblestone, with `occupants` in the world. */
function fakeBot(occupants: Occupant[]) {
  const world = new Map([['10,63,0', 'stone']]);
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
  const placeBlock = vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
    world.set(key(reference.position.plus(face)), 'cobblestone');
  });
  const entities = Object.fromEntries(
    occupants.map((entity, i) => [String(i + 1), { width: 0.6, height: 1.8, ...entity }]),
  );
  const bot = {
    entity: { position: new Vec3(7.5, 64, 0.5), yaw: 0 },
    entities,
    heldItem: { name: 'cobblestone', count: 1 },
    registry: {
      blocksByName: {
        cobblestone: { boundingBox: 'block' },
        stone: { boundingBox: 'block' },
      },
    },
    inventory: { items: () => [{ name: 'cobblestone', count: 1 }] },
    equip: vi.fn(async () => undefined),
    look: vi.fn(async () => undefined),
    setControlState: vi.fn(),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block', shapes: [] };
    },
    placeBlock,
  };
  return { bot: bot as unknown as Bot, placeBlock };
}

/** Runs the `place` handler for cobblestone at the target, with a fresh abort signal. */
function placeAtTarget(bot: Bot) {
  return placeAction.run(
    { bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block: 'cobblestone', at: TARGET },
  );
}

/** An entity standing in the target cell: its box spans x 10.2 to 10.8 and y 64 to 65.8. */
const STANDING = new Vec3(10.5, 64, 0.5);

describe('place with an entity in the target cell', () => {
  it('refuses a cell a player stands in, with the player text, and sends no place', async () => {
    const fake = fakeBot([{ type: 'player', name: 'Kimberly', position: STANDING }]);
    const outcome = await placeAtTarget(fake.bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'someone is standing there',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses a cell a mob stands in, with the other-entity text, and sends no place', async () => {
    const fake = fakeBot([{ type: 'mob', name: 'zombie', position: STANDING }]);
    const outcome = await placeAtTarget(fake.bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'something is standing there',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('does not block on a dropped item in the target cell', async () => {
    const fake = fakeBot([{ type: 'object', name: 'item', position: STANDING }]);
    const outcome = await placeAtTarget(fake.bot);
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('does not block on an XP orb in the target cell', async () => {
    const fake = fakeBot([{ type: 'orb', name: 'experience_orb', position: STANDING }]);
    const outcome = await placeAtTarget(fake.bot);
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
  });
});
