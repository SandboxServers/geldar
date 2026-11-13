import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from './pathing.ts';
import { type PickupOutcome, pickUpDrops, pickupNote } from './pickup.ts';
import type { ActionContext } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

interface DropOptions {
  /** Cells holding water: a drop there is not chased. */
  waterAt?: Vec3[];
}

/**
 * A bot with the parts pickup reads. Item drops are entities named `item`. A walk to a drop within
 * one block takes it: the inventory gains its item and `playerCollect` fires for the bot.
 */
function fakeBot(options: DropOptions = {}) {
  const self = { position: new Vec3(0, 64, 0) };
  const events = new EventEmitter();
  const entities: Record<number, unknown> = { 1: self };
  const inventory: { name: string; count: number }[] = [];
  const bot = {
    entity: self,
    entities,
    inventory: { items: () => inventory.map((stack) => ({ ...stack })) },
    blockAt: vi.fn((at: Vec3) => ({
      name: (options.waterAt ?? []).some((water) => water.equals(at)) ? 'water' : 'grass_block',
    })),
    waitForTicks: vi.fn(async (_ticks: number) => undefined),
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    removeListener: (event: string, listener: (...args: unknown[]) => void) =>
      events.off(event, listener),
  };
  let nextId = 10;
  const drop = (itemName: string, at: Vec3): number => {
    const id = nextId++;
    entities[id] = { id, name: 'item', itemName, position: at, isValid: true };
    return id;
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
    const item = entity as { itemName: string };
    delete entities[Number(id)];
    inventory.push({ name: item.itemName, count: 1 });
    events.emit('playerCollect', self, entity);
    return { ok: true, distance: 1 };
  });
  return { bot: bot as unknown as Bot, drop, inventory, entities, raw: bot };
}

function ctxFor(bot: Bot, signal = new AbortController().signal): ActionContext {
  return { bot, signal, timeScale: 1 };
}

async function pickup(bot: Bot, signal?: AbortSignal): Promise<PickupOutcome> {
  return pickUpDrops(ctxFor(bot, signal), new Vec3(0, 64, 0), []);
}

describe('pickUpDrops', () => {
  beforeEach(() => {
    walk.mockReset();
  });

  it('takes the drop near the spot and names what the bot gained', async () => {
    const { bot, drop, inventory } = fakeBot();
    drop('beef', new Vec3(2, 64, 0));
    const outcome = await pickup(bot);
    expect(outcome).toEqual({ picked: ['beef'], left: false, aborted: false });
    expect(inventory).toEqual([{ name: 'beef', count: 1 }]);
    expect(pickupNote(outcome)).toBe('picked up beef');
  });

  it('does not chase a drop lying in water and says it was left', async () => {
    const { bot, drop } = fakeBot({ waterAt: [new Vec3(2, 64, 0)] });
    drop('cod', new Vec3(2, 64, 0));
    const outcome = await pickup(bot);
    expect(walk).not.toHaveBeenCalled();
    expect(outcome).toEqual({ picked: [], left: true, aborted: false });
    expect(pickupNote(outcome)).toBe('drops were left on the ground');
  });

  it('ignores a drop beyond the pickup radius', async () => {
    const { bot, drop } = fakeBot();
    drop('beef', new Vec3(6, 64, 0));
    const outcome = await pickup(bot);
    expect(walk).not.toHaveBeenCalled();
    expect(outcome).toEqual({ picked: [], left: false, aborted: false });
    expect(pickupNote(outcome)).toBeNull();
  });

  it('leaves a drop it cannot reach, after one walk', async () => {
    const { bot, drop } = fakeBot();
    drop('beef', new Vec3(-3, 64, 0));
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });
    const outcome = await pickup(bot);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ picked: [], left: true, aborted: false });
  });

  it('makes at most six walks, so a seventh drop is left', async () => {
    const { bot, drop } = fakeBot();
    for (let i = 0; i < 7; i++) drop('beef', new Vec3(1, 64, 0));
    const outcome = await pickup(bot);
    expect(walk).toHaveBeenCalledTimes(6);
    expect(outcome.left).toBe(true);
  });

  it('aborted before it starts, it walks to nothing', async () => {
    const { bot, drop } = fakeBot();
    drop('beef', new Vec3(2, 64, 0));
    const controller = new AbortController();
    controller.abort();
    const outcome = await pickup(bot, controller.signal);
    expect(walk).not.toHaveBeenCalled();
    expect(outcome.aborted).toBe(true);
  });

  it('an abort during a walk ends the pickup at once', async () => {
    const { bot, drop } = fakeBot();
    drop('beef', new Vec3(2, 64, 0));
    drop('beef', new Vec3(-2, 64, 0));
    const controller = new AbortController();
    walk.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: false, reason: 'cancelled', message: 'aborted' };
    });
    const outcome = await pickup(bot, controller.signal);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(outcome.aborted).toBe(true);
  });

  it('removes its playerCollect listener when it ends', async () => {
    const { bot, drop, raw } = fakeBot();
    drop('beef', new Vec3(2, 64, 0));
    const spy = vi.spyOn(raw, 'removeListener');
    await pickup(bot);
    expect(spy).toHaveBeenCalledWith('playerCollect', expect.any(Function));
  });
});

describe('pickupNote', () => {
  it('reads the picked names, the drops left, or both', () => {
    expect(pickupNote({ picked: ['beef', 'feather'], left: false, aborted: false })).toBe(
      'picked up beef, feather',
    );
    expect(pickupNote({ picked: [], left: true, aborted: false })).toBe(
      'drops were left on the ground',
    );
    expect(pickupNote({ picked: ['beef'], left: true, aborted: false })).toBe(
      'picked up beef; drops were left on the ground',
    );
    expect(pickupNote({ picked: [], left: false, aborted: false })).toBeNull();
  });
});
