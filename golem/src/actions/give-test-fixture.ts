import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import { FakeWorld } from '../perception/perception.fakes.ts';
import { giveAction } from './give.ts';
import type { ActionOutcome } from './outcome.ts';

/** What the server does after a toss: the item entities it drops, and who picks which one up. */
export interface Pickups {
  dropped?: number[];
  picked?: number[];
  by?: string;
  abortOnToss?: boolean;
  /** When set, the pickups happen this many ms after the toss, as a real pickup delay does. */
  after?: number;
  /**
   * Spawns real prismarine-entity items: empty metadata at `entitySpawn`, then, when `stack` is
   * set, the metadata with that stack and an `itemDrop`. Without `stack` the metadata never arrives.
   */
  real?: { stack?: number };
  /** Spawns item entities whose `position` getter throws, to force a listener body to throw. */
  broken?: boolean;
}

// mineflayer builds its entities from its own prismarine-entity, so the same copy is used here.
const fromMineflayer = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const REAL_VERSION = '1.21.4';
const RealEntity = fromMineflayer('prismarine-entity')(REAL_VERSION);
const realRegistry = fromMineflayer('prismarine-registry')(REAL_VERSION);

/** A real item entity at `at`, with the metadata empty as it is at `entitySpawn`. */
function realItem(id: number, at: Vec3) {
  const entity = new RealEntity(id);
  entity.name = 'item';
  entity.position = at;
  return entity;
}

/** Puts an item stack of `count` oak_log into a real item's metadata, as the server's packet does. */
function setRealStack(entity: { metadata: unknown[] }, count: number): void {
  const index = realRegistry.supportFeature('metadataIxOfItem');
  entity.metadata[index] = {
    present: true,
    itemId: realRegistry.itemsByName.oak_log.id,
    itemCount: count,
    nbtData: null,
  };
}

/**
 * A fake world with a Kestrel bot at the origin, 5 oak_log in the inventory, a toss spy, and an
 * event emitter. A toss spawns the `dropped` item entities and emits the `picked` pickups by
 * `by` (default Pike), both before it resolves, as the server does.
 */
export function setup(held = 5, pickups: Pickups = {}) {
  const world = new FakeWorld();
  // A stone floor under the area around the Body, so a step-back spot has solid ground under it.
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) world.set('stone', x, 63, z);
  }
  const events = new EventEmitter();
  const controller = new AbortController();
  const pike = { type: 'player', username: pickups.by ?? 'Pike', position: new Vec3(0.5, 64, 2.5) };
  // The entities the toss spawned, by id, so a pickup is of the same entity.
  const spawned = new Map<number, unknown>();
  const item = (id: number) => ({
    id,
    name: 'item',
    type: 'other',
    position: new Vec3(0.5, 64, 3.5),
  });
  const spawn = (id: number) => {
    if (pickups.broken) {
      return {
        id,
        name: 'item',
        type: 'other',
        get position(): Vec3 {
          throw new Error('position unreadable');
        },
      };
    }
    return pickups.real ? realItem(id, new Vec3(0.5, 64, 3.5)) : item(id);
  };
  const toss = vi.fn(async () => {
    order.push('toss');
    for (const id of pickups.dropped ?? [7]) {
      const entity = spawn(id);
      spawned.set(id, entity);
      events.emit('entitySpawn', entity);
      if (pickups.real?.stack !== undefined) {
        setRealStack(entity, pickups.real.stack);
        events.emit('itemDrop', entity);
      }
    }
    for (const id of pickups.picked ?? [7]) {
      const entity = spawned.get(id) ?? item(id);
      if (pickups.after === undefined) events.emit('playerCollect', pike, entity);
      else setTimeout(() => events.emit('playerCollect', pike, entity), pickups.after);
    }
    if (pickups.abortOnToss) controller.abort();
  });
  // The calls the Body makes before a toss, in order, as the fake bot saw them.
  const order: string[] = [];
  // As mineflayer's lookAt does, minus the packet: it turns the Body to face the point.
  const lookAt = vi.fn(async (at: Vec3, _force?: boolean) => {
    order.push('lookAt');
    bot.entity.yaw = Math.atan2(-(at.x - bot.entity.position.x), -(at.z - bot.entity.position.z));
  });
  const look = vi.fn(async (_yaw: number, _pitch: number, _force?: boolean) => {
    order.push('look');
  });
  const waitForTicks = vi.fn(async (_ticks: number) => {
    order.push('waitForTicks');
  });
  // The server's full player list: a player listed here is known to the server, not to the agent.
  const players: Record<string, unknown> = { Hidden: { entity: { position: new Vec3(0, 64, 5) } } };
  const bot = Object.assign(world.bot, {
    players,
    inventory: { items: () => [{ name: 'oak_log', count: held }] },
    registry: { items: {}, itemsByName: { oak_log: { id: 42 } } },
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
    emit: events.emit.bind(events),
    toss,
    lookAt,
    look,
    waitForTicks,
  }) as Bot;
  const run = (to: string, count = 3, item = 'oak_log', timeScale = 1): Promise<ActionOutcome> =>
    giveAction.run(
      { bot, signal: controller.signal, timeScale },
      {
        do: 'give',
        to,
        item,
        count,
      },
    );
  return { world, run, toss, lookAt, look, waitForTicks, order, events, controller };
}
