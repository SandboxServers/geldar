import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { isOwnPlacement, MAX_OWN_RECORDS, recordOwnPlacement } from './own-placements.ts';
import { placeAgainst } from './pillar.ts';

/** A bot with the `on` hook the record uses; `handlers` keeps the last handler per event. */
function eventBot() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const bot = {
    on: (event: string, fn: (...args: unknown[]) => void) => {
      handlers[event] = fn;
    },
    setControlState: () => undefined,
  };
  return { bot: bot as unknown as Bot, handlers };
}

describe('the own-placement record is bounded and cleared (0164, review N6)', () => {
  it('keeps at most MAX_OWN_RECORDS cells per bot and drops the oldest first', () => {
    const { bot } = eventBot();
    for (let i = 0; i <= MAX_OWN_RECORDS; i++) {
      recordOwnPlacement(bot, { x: i, y: 64, z: 0 }, 'cobblestone');
    }
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(false);
    expect(isOwnPlacement(bot, { x: 1, y: 64, z: 0 })).toBe(true);
    expect(isOwnPlacement(bot, { x: MAX_OWN_RECORDS, y: 64, z: 0 })).toBe(true);
  });

  it('a re-placed cell is the newest, so it is not the one dropped', () => {
    const { bot } = eventBot();
    recordOwnPlacement(bot, { x: 0, y: 64, z: 0 }, 'cobblestone');
    for (let i = 1; i < MAX_OWN_RECORDS; i++) {
      recordOwnPlacement(bot, { x: i, y: 64, z: 0 }, 'cobblestone');
    }
    recordOwnPlacement(bot, { x: 0, y: 64, z: 0 }, 'cobblestone');
    recordOwnPlacement(bot, { x: MAX_OWN_RECORDS, y: 64, z: 0 }, 'cobblestone');
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(true);
    expect(isOwnPlacement(bot, { x: 1, y: 64, z: 0 })).toBe(false);
  });

  it('clears the record on respawn (a new world or a dimension change)', () => {
    const { bot, handlers } = eventBot();
    recordOwnPlacement(bot, { x: 1, y: 64, z: 1 }, 'cobblestone');
    handlers.respawn?.();
    expect(isOwnPlacement(bot, { x: 1, y: 64, z: 1 })).toBe(false);
  });
});

describe('placeAgainst records the block it placed, also from the last of a stack (review N5)', () => {
  it('records the cell even when the held item is gone once the block is placed', async () => {
    const { bot } = eventBot();
    const body = bot as unknown as { heldItem: { name: string } | null; placeBlock: unknown };
    body.heldItem = { name: 'cobblestone' };
    body.placeBlock = async () => {
      body.heldItem = null;
    };
    await placeAgainst(
      bot,
      { name: 'dirt', position: new Vec3(0, 64, 0) } as never,
      new Vec3(0, 1, 0),
    );
    expect(isOwnPlacement(bot, { x: 0, y: 65, z: 0 })).toBe(true);
  });
});
