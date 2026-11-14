import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { setup } from './give-test-fixture.ts';

const pike = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };

/** An item entity whose `id` getter throws, so any listener that reads the id throws. */
const unreadable = {
  type: 'other',
  name: 'item',
  position: new Vec3(0.5, 64, 3.5),
  get id(): number {
    throw new Error('id unreadable');
  },
};

/** A collect packet whose `collectedEntityId` getter throws, so the packet listener throws. */
const unreadablePacket = {
  get collectedEntityId(): number {
    throw new Error('packet unreadable');
  },
  pickupItemCount: 1,
};

/**
 * Runs a give whose toss calls `emitDuring` on the bot's events and the client's. Returns what
 * the emits threw: an empty list when no listener let a throw reach the emitter.
 */
async function escapesFrom(
  emitDuring: (events: EventEmitter, client: EventEmitter) => void,
): Promise<unknown[]> {
  const { world, run, toss, events } = setup(5, { dropped: [], picked: [] });
  world.entities[2] = pike;
  const client = new EventEmitter();
  Object.assign(world.bot, { _client: client });
  const escaped: unknown[] = [];
  toss.mockImplementationOnce(async () => {
    try {
      emitDuring(events, client);
    } catch (error) {
      escaped.push(error);
    }
  });
  await run('Pike', 3, 'oak_log', 0.01);
  return escaped;
}

describe('give: each listener is guarded', () => {
  it('does not throw into the emitter from the itemDrop listener', async () => {
    expect(await escapesFrom((events) => events.emit('itemDrop', unreadable))).toEqual([]);
  });

  it('does not throw into the emitter from the entityGone listener', async () => {
    expect(await escapesFrom((events) => events.emit('entityGone', unreadable))).toEqual([]);
  });

  it('does not throw into the emitter from the playerCollect listener', async () => {
    expect(
      await escapesFrom((events) => events.emit('playerCollect', pike, unreadable)),
    ).toEqual([]);
  });

  it('does not throw into the client from the collect packet listener', async () => {
    expect(
      await escapesFrom((_events, client) => client.emit('collect', unreadablePacket)),
    ).toEqual([]);
  });
});
