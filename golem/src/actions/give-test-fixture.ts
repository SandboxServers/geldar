import { EventEmitter } from 'node:events';
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
}

/**
 * A fake world with a Kestrel bot at the origin, 5 oak_log in the inventory, a toss spy, and an
 * event emitter. A toss spawns the `dropped` item entities and emits the `picked` pickups by
 * `by` (default Pike), both before it resolves, as the server does.
 */
export function setup(held = 5, pickups: Pickups = {}) {
  const world = new FakeWorld();
  const events = new EventEmitter();
  const controller = new AbortController();
  const pike = { type: 'player', username: pickups.by ?? 'Pike', position: new Vec3(0.5, 64, 2.5) };
  const item = (id: number) => ({
    id,
    name: 'item',
    type: 'other',
    position: new Vec3(0.5, 64, 3.5),
  });
  const toss = vi.fn(async () => {
    order.push('toss');
    for (const id of pickups.dropped ?? [7]) events.emit('entitySpawn', item(id));
    for (const id of pickups.picked ?? [7]) {
      if (pickups.after === undefined) events.emit('playerCollect', pike, item(id));
      else setTimeout(() => events.emit('playerCollect', pike, item(id)), pickups.after);
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
