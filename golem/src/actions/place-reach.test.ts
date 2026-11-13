import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** The target cell in these tests: a stone block below it is the reference, and the cell itself is air. */
const TARGET = { x: 10, y: 64, z: 0 };

interface FakeBot {
  bot: Bot;
  placeBlock: ReturnType<typeof vi.fn>;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot standing at `at`, holding cobblestone, beside a stone block that sits under the target. */
function fakeBot(at: Vec3): FakeBot {
  const world = new Map([['10,63,0', 'stone']]);
  const placeBlock = vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
    world.set(key(reference.position.plus(face)), 'cobblestone');
  });
  const bot = {
    entity: { position: at, yaw: 0 },
    entities: {},
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
function placeAtTarget(fake: FakeBot) {
  return placeAction.run(
    { bot: fake.bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block: 'cobblestone', at: TARGET },
  );
}

beforeEach(() => {
  vi.mocked(moveNear).mockReset();
  vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 } as never);
});

describe('place reach after a full walk', () => {
  it('refuses when a full walk ends farther than reach, and does not place', async () => {
    // The walk reports success but the bot never moved: it is still about 9.5 blocks away.
    const fake = fakeBot(new Vec3(0.5, 64, 0.5));
    const outcome = await placeAtTarget(fake);
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the target is out of reach',
    });
    expect(fake.placeBlock).not.toHaveBeenCalled();
  });

  it('places when the full walk ends within reach', async () => {
    const fake = fakeBot(new Vec3(0.5, 64, 0.5));
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      fake.bot.entity.position = new Vec3(8.5, 64, 0.5);
      return { ok: true, distance: 8 } as never;
    });
    const outcome = await placeAtTarget(fake);
    expect(outcome.status).toBe('completed');
    expect(fake.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('places at 4.4 blocks from the target and refuses at 4.6 (the reach edge)', async () => {
    const near = fakeBot(new Vec3(0.5, 64, 0.5));
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      near.bot.entity.position = new Vec3(5.6, 64, 0.5);
      return { ok: true, distance: 4 } as never;
    });
    expect((await placeAtTarget(near)).status).toBe('completed');

    const far = fakeBot(new Vec3(0.5, 64, 0.5));
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      far.bot.entity.position = new Vec3(5.4, 64, 0.5);
      return { ok: true, distance: 4 } as never;
    });
    const outcome = await placeAtTarget(far);
    expect(outcome).toMatchObject({ status: 'failed', message: 'the target is out of reach' });
    expect(far.placeBlock).not.toHaveBeenCalled();
  });
});
