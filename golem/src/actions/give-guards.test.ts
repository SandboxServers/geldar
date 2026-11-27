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
    expect(await escapesFrom((events) => events.emit('playerCollect', pike, unreadable))).toEqual(
      [],
    );
  });

  it('does not throw into the client from the collect packet listener', async () => {
    expect(
      await escapesFrom((_events, client) => client.emit('collect', unreadablePacket)),
    ).toEqual([]);
  });
});

describe('give: a bystander next to the recipient or the toss line (crowd guard)', () => {
  it('refuses when another player stands within 2 blocks of the recipient, and keeps the items', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'ag_mara_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.entities[3] = { type: 'player', username: 'ag_kit_01', position: new Vec3(1.5, 64, 2.5) };
    expect(await run('ag_mara_01')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'someone else stands within 2 blocks of ag_mara_01; the items stay with you',
    });
    expect(toss).not.toHaveBeenCalled();
  });

  it('refuses when another player stands beside the toss line, and keeps the items', async () => {
    const { world, run, toss } = setup();
    world.entities[2] = {
      type: 'player',
      username: 'ag_mara_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.entities[3] = {
      type: 'player',
      username: 'ag_kit_01',
      position: new Vec3(-0.3, 64, 0.6),
    };
    expect(await run('ag_mara_01')).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'someone else stands beside the toss line to ag_mara_01; the items stay with you',
    });
    expect(toss).not.toHaveBeenCalled();
  });

  it('tosses when the nearest other player stands 5 blocks from the recipient', async () => {
    const { world, run, toss } = setup(5, { by: 'ag_mara_01' });
    world.entities[2] = {
      type: 'player',
      username: 'ag_mara_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    world.entities[3] = { type: 'player', username: 'ag_kit_01', position: new Vec3(5.5, 64, 2.5) };
    expect(await run('ag_mara_01')).toMatchObject({ status: 'completed' });
    expect(toss).toHaveBeenCalledTimes(1);
  });

  it('never counts the recipient as a bystander of their own toss', async () => {
    const { world, run, toss } = setup(5, { by: 'ag_mara_01' });
    world.entities[2] = {
      type: 'player',
      username: 'ag_mara_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(await run('ag_mara_01')).toMatchObject({ status: 'completed' });
    expect(toss).toHaveBeenCalledTimes(1);
  });
});
