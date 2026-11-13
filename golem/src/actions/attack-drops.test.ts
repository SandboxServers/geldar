import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attackAction } from './attack.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

interface FakeOptions {
  /** The item the zombie drops on death; null for no drop. */
  dropName?: string | null;
  /** Cells holding water: a drop there is not chased. */
  waterAt?: Vec3[];
}

/**
 * A bot with one zombie that dies on the third swing. Its drop appears where it died. A walk to a
 * drop within one block takes it: the inventory gains the item and `playerCollect` fires.
 */
function fakeBot(options: FakeOptions = {}) {
  const self = { position: new Vec3(0, 64, 0) };
  const events = new EventEmitter();
  const zombie = {
    id: 7,
    name: 'zombie',
    position: new Vec3(2, 64, 0),
    height: 1.95,
    isValid: true,
  };
  const entities: Record<string, unknown> = { 1: self, 7: zombie };
  const inventory: { name: string; count: number }[] = [];
  let hits = 0;
  const bot = {
    entity: self,
    entities,
    heldItem: null,
    inventory: { items: () => inventory.map((stack) => ({ ...stack })) },
    blockAt: vi.fn((at: Vec3) => ({
      name: (options.waterAt ?? []).some((water) => water.equals(at)) ? 'water' : 'grass_block',
    })),
    equip: vi.fn(async () => undefined),
    lookAt: vi.fn(async () => undefined),
    attack: vi.fn(() => {
      hits += 1;
      if (hits < 3) return;
      zombie.isValid = false;
      delete entities[7];
      if (options.dropName !== null) {
        entities[20] = {
          id: 20,
          name: 'item',
          itemName: options.dropName ?? 'rotten_flesh',
          position: zombie.position,
          isValid: true,
        };
      }
    }),
    waitForTicks: vi.fn(async (_ticks: number) => undefined),
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    removeListener: (event: string, listener: (...args: unknown[]) => void) =>
      events.off(event, listener),
  };
  walk.mockImplementation(async (_bot, target) => {
    const found = Object.entries(entities).find(
      ([, entity]) =>
        (entity as { name: string }).name === 'item' &&
        (entity as { position: Vec3 }).position.distanceTo(new Vec3(target.x, target.y, target.z)) <
          1,
    );
    if (!found) return { ok: false, reason: 'blocked', message: 'no drop there' };
    const [id, entity] = found;
    delete entities[id];
    inventory.push({ name: (entity as { itemName: string }).itemName, count: 1 });
    events.emit('playerCollect', self, entity);
    return { ok: true, distance: 1 };
  });
  return { bot: bot as unknown as Bot, inventory, raw: bot };
}

function attack(bot: Bot, signal = new AbortController().signal) {
  return attackAction.run({ bot, signal, timeScale: 1 }, { do: 'attack', target: 'zombie' });
}

describe('attack picks up the drops of a kill', () => {
  beforeEach(() => {
    walk.mockReset();
  });

  it('collects the drop of a kill and names it', async () => {
    const { bot, inventory } = fakeBot({ dropName: 'beef' });
    const outcome = await attack(bot);
    expect(outcome).toMatchObject({
      status: 'completed',
      detail: { killed: true, picked: ['beef'], note: 'picked up beef' },
    });
    expect(inventory).toEqual([{ name: 'beef', count: 1 }]);
  });

  it('a kill whose drop lies in water is not chased and the drop is reported left', async () => {
    const { bot } = fakeBot({ waterAt: [new Vec3(2, 64, 0)] });
    const outcome = await attack(bot);
    expect(walk).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      status: 'completed',
      detail: { killed: true, note: 'drops were left on the ground' },
    });
  });

  it('a kill with no drop has no pickup note', async () => {
    const { bot } = fakeBot({ dropName: null });
    const outcome = await attack(bot);
    expect(outcome.status).toBe('completed');
    expect(outcome.detail).not.toHaveProperty('note');
  });

  it('an abort during the pickup cancels the action', async () => {
    const controller = new AbortController();
    const { bot } = fakeBot({ dropName: 'beef' });
    walk.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: false, reason: 'cancelled', message: 'aborted' };
    });
    const outcome = await attack(bot, controller.signal);
    expect(outcome.status).toBe('cancelled');
  });
});
