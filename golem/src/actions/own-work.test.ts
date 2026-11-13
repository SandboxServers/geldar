import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { scriptedBot } from './escape-ladder.fakes.ts';
import { digAllowed } from './goto-dig.ts';
import { isOwnPlacement, recordOwnPlacement } from './own-placements.ts';
import { placeAgainst, sideDigCell } from './pillar.ts';
import { isProtected, protectedReason } from './protected-blocks.ts';

const registry = minecraftData('1.21.4');

/** A world block as `bot.blockAt` returns it, from its name. */
function worldCell(name: string, pos: Vec3) {
  return {
    name,
    type: registry.blocksByName[name]?.id,
    boundingBox: name === 'air' ? 'empty' : 'block',
    position: pos,
  };
}

/**
 * An event-emitting body standing at (0.5, 65, 0.5) over the column x=0, z=0. `solid` is read on
 * every call, so a test can change a cell and emit the update the game sends.
 */
function emittingBody(solid: Record<string, string>): Bot {
  const body = new EventEmitter();
  return Object.assign(body, {
    username: 'self',
    registry,
    health: 20,
    entity: { position: new Vec3(0.5, 65, 0.5) },
    blockAt: (pos: Vec3) => worldCell(solid[`${pos.x},${pos.y},${pos.z}`] ?? 'air', pos),
  }) as never as Bot;
}

/** Facts the rules read about the cells around a block: no liquid, no falling block, no entity. */
const CALM_MOVES = {
  getBlock: () => ({ liquid: false, canFall: false }),
  getNumEntitiesAt: () => 0,
};

/** Solid ground under the dug column, so the floor drop rule never refuses. */
const GROUND = { '0,63,0': 'stone', '0,62,0': 'stone', '0,61,0': 'stone' };

describe("own placements are the bot's own work (0164, F10)", () => {
  it('lets tier 2 dig its own placed cobblestone, though the type is built material', () => {
    const solid = { '0,64,0': 'cobblestone', ...GROUND };
    const bot = emittingBody(solid);
    recordOwnPlacement(bot, { x: 0, y: 64, z: 0 }, 'cobblestone');
    const block = { name: 'cobblestone', type: 1, position: new Vec3(0, 64, 0) };
    expect(digAllowed(bot, CALM_MOVES as never, block)).toBe(true);
  });

  it("keeps someone else's cobblestone protected: it is not in the record", () => {
    const solid = { '0,64,0': 'cobblestone', ...GROUND };
    const bot = emittingBody(solid);
    recordOwnPlacement(bot, { x: 5, y: 64, z: 5 }, 'cobblestone');
    const block = { name: 'cobblestone', type: 1, position: new Vec3(0, 64, 0) };
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(false);
    expect(digAllowed(bot, CALM_MOVES as never, block)).toBe(false);
  });

  it('ends the record when the cell changes to something else, and keeps it for the same block', () => {
    const solid = { '0,64,0': 'cobblestone', ...GROUND };
    const bot = emittingBody(solid);
    recordOwnPlacement(bot, { x: 0, y: 64, z: 0 }, 'cobblestone');
    const at = new Vec3(0, 64, 0);
    const block = { name: 'cobblestone', type: 1, position: at };
    const emit = (name: string) =>
      (bot as unknown as EventEmitter).emit(
        'blockUpdate',
        worldCell('cobblestone', at),
        worldCell(name, at),
      );
    emit('cobblestone');
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(true);
    expect(digAllowed(bot, CALM_MOVES as never, block)).toBe(true);
    emit('air');
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(false);
    expect(isProtected(bot, block)).toBe(true);
    expect(digAllowed(bot, CALM_MOVES as never, block)).toBe(false);
  });

  it('records a block that place sends (the held block lands at the reference plus the face)', async () => {
    const { bot, asBot } = scriptedBot({
      blocks: { '0,63,0': { name: 'stone', boundingBox: 'block' } },
    });
    (bot as unknown as { heldItem: { name: string } }).heldItem = { name: 'cobblestone' };
    await placeAgainst(
      asBot,
      { name: 'stone', position: new Vec3(0, 63, 0) } as never,
      new Vec3(0, 1, 0),
    );
    expect(isOwnPlacement(asBot, { x: 0, y: 64, z: 0 })).toBe(true);
    expect(isOwnPlacement(asBot, { x: 0, y: 63, z: 0 })).toBe(false);
  });
});

describe("the pillar side dig never digs someone else's work (0164)", () => {
  const FEET = new Vec3(0, 64, 0);

  it('refuses a side cell of built material, where the cell itself is the only candidate', () => {
    const { bot, asBot } = scriptedBot({
      blocks: {
        '1,63,0': { name: 'stone', boundingBox: 'block' },
        '1,64,0': { name: 'oak_planks', boundingBox: 'block' },
        '1,65,0': { name: 'stone', boundingBox: 'block' },
      },
    });
    expect(bot).toBeDefined();
    expect(sideDigCell(asBot, FEET)).toBeNull();
  });

  it('still offers a natural side cell with the same ground', () => {
    const { asBot } = scriptedBot({
      blocks: {
        '1,63,0': { name: 'stone', boundingBox: 'block' },
        '1,64,0': { name: 'stone', boundingBox: 'block' },
        '1,65,0': { name: 'stone', boundingBox: 'block' },
      },
    });
    expect(sideDigCell(asBot, FEET)?.x).toBe(1);
  });

  it('gives the protection reason for built material and none for natural stone', () => {
    const { asBot } = scriptedBot({ blocks: {} });
    const planks = { name: 'oak_planks', position: new Vec3(0, 64, 0) };
    const stone = { name: 'stone', position: new Vec3(0, 60, 0) };
    expect(protectedReason(asBot, planks, planks.position)).toContain('someone else');
    expect(protectedReason(asBot, stone, stone.position)).toBeNull();
  });
});

describe('own blocks do not shield terrain beside them (0164)', () => {
  const DIRT = { name: 'dirt', position: new Vec3(0, 64, 0) };

  it("dirt beside the bot's own cobblestone is diggable", () => {
    const bot = emittingBody({ '0,64,0': 'dirt', '1,64,0': 'cobblestone', ...GROUND });
    recordOwnPlacement(bot, { x: 1, y: 64, z: 0 }, 'cobblestone');
    expect(isProtected(bot, DIRT)).toBe(false);
    expect(protectedReason(bot, DIRT, DIRT.position)).toBeNull();
  });

  it("dirt beside someone else's cobblestone stays protected", () => {
    const bot = emittingBody({ '0,64,0': 'dirt', '1,64,0': 'cobblestone', ...GROUND });
    recordOwnPlacement(bot, { x: 5, y: 64, z: 5 }, 'cobblestone');
    expect(isProtected(bot, DIRT)).toBe(true);
    expect(protectedReason(bot, DIRT, DIRT.position)).toContain('someone else');
  });
});
