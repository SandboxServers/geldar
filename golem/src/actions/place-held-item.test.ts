import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { placeAction } from './place.ts';

/** A bot with a stone floor under the target, dirt in the inventory, and a placement that finds no item in hand. */
function fakeBot(): Bot {
  const cells: Record<string, string> = { '2,63,0': 'stone' };
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0 },
    entities: {},
    heldItem: null,
    registry: { blocksByName: { dirt: { boundingBox: 'block' } } },
    inventory: { items: () => [{ name: 'dirt', count: 1 }] },
    equip: vi.fn(async () => undefined),
    look: vi.fn(async () => undefined),
    setControlState: vi.fn(),
    blockAt: (p: Vec3) => {
      const name = cells[`${p.x},${p.y},${p.z}`] ?? 'air';
      return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block', shapes: [] };
    },
    placeBlock: vi.fn(async () => {
      throw new Error('must be holding an item to place');
    }),
  };
  return bot as unknown as Bot;
}

describe('place when the held item runs out mid-build', () => {
  it('fails with missing_materials and no raw text when the last block is used up', async () => {
    const outcome = await placeAction.run(
      { bot: fakeBot(), signal: new AbortController().signal, timeScale: 1 },
      { do: 'place', block: 'dirt', at: { x: 2, y: 64, z: 0 } },
    );
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'missing_materials',
      message: 'no dirt in the inventory',
      detail: {},
    });
    expect(JSON.stringify(outcome)).not.toContain('must be holding');
  });
});
