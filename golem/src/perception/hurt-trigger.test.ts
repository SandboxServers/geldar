import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { type HurtEvent, HurtReporter } from './hurt.ts';
import { hurtWorldEvent, watchHurts } from './hurt-trigger.ts';

interface FakeEntity {
  id: number;
  position: {
    x: number;
    y: number;
    z: number;
    distanceTo(other: { x: number; y: number; z: number }): number;
  };
  yaw: number;
}

/** An entity standing at (x, 64, z) with the given yaw; distances are horizontal here. */
function entityAt(id: number, x: number, z: number, yaw = 0): FakeEntity {
  return {
    id,
    position: {
      x,
      y: 64,
      z,
      distanceTo: (other) => Math.hypot(x - other.x, z - other.z),
    },
    yaw,
  };
}

/** A fake mineflayer bot: an EventEmitter with the fields and lookup the trigger reads. */
function fakeBot(self: FakeEntity, others: FakeEntity[] = []) {
  return Object.assign(new EventEmitter(), {
    health: 20 as number | undefined,
    entity: self,
    nearestEntity: (filter?: (entity: FakeEntity) => boolean) =>
      others.find((entity) => (filter ? filter(entity) : true)) ?? null,
  });
}

/** Watches a fake bot and records every hurt the reporter passes on, with its world age. */
function harness(bot: ReturnType<typeof fakeBot>) {
  const seen: [HurtEvent, number][] = [];
  const reporter = new HurtReporter((hurt, tick) => seen.push([hurt, tick]));
  const detach = watchHurts(bot as unknown as Bot, reporter, () => 77);
  return { seen, reporter, detach };
}

describe('watchHurts: the live hurt trigger', () => {
  it('a hit from a nearby attacker in front is a melee hurt with a bearing', () => {
    const self = entityAt(1, 0, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, 2)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.health = 16.4;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 4 }, 77]]);
  });

  it('an attacker behind the Body, with the Body facing +z, is behind', () => {
    const self = entityAt(1, 0, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, -2)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.health = 17;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'behind', amount: 3 }, 77]]);
  });

  it('a drop with no entityHurt (a fall) is other with no bearing', () => {
    const bot = fakeBot(entityAt(1, 0, 0));
    const { seen } = harness(bot);
    bot.health = 17;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'other', amount: 3 }, 77]]);
    expect(seen[0]?.[0]).not.toHaveProperty('bearing');
  });

  it('an entityHurt with no attacker within reach is not a melee hit', () => {
    const self = entityAt(1, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, 10)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.health = 18;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'other', amount: 2 }, 77]]);
  });

  it('an entityHurt on another entity does not set the attacker', () => {
    const self = entityAt(1, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, 2)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', entityAt(3, 5, 5));
    bot.health = 18;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'other', amount: 2 }, 77]]);
  });

  it('an attack is used by the next health drop only', () => {
    const self = entityAt(1, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, 2)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.emit('health');
    bot.health = 17;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'other', amount: 3 }, 77]]);
  });

  it('a health rise is not a hurt', () => {
    const bot = fakeBot(entityAt(1, 0, 0));
    const { seen } = harness(bot);
    bot.health = 22;
    bot.emit('health');
    expect(seen).toEqual([]);
  });

  it('after detach, a health drop is not reported', () => {
    const bot = fakeBot(entityAt(1, 0, 0));
    const { seen, detach } = harness(bot);
    detach();
    bot.health = 10;
    bot.emit('health');
    expect(seen).toEqual([]);
  });

  it('after the reporter closes (the bot ended), a health drop is not reported', () => {
    const bot = fakeBot(entityAt(1, 0, 0));
    const { seen, reporter } = harness(bot);
    reporter.close();
    bot.health = 10;
    bot.emit('health');
    expect(seen).toEqual([]);
  });
});

describe('hurtWorldEvent: the damage event the Mind reads', () => {
  const at = '2026-11-11T00:00:00.000Z';

  it('carries source, bearing and amount in a damage WorldEvent', () => {
    const self = entityAt(1, 0, 0);
    const bot = fakeBot(self, [entityAt(2, 0, 2)]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.health = 16;
    bot.emit('health');
    const [hurt] = seen[0] ?? [];
    expect(hurt).toBeDefined();
    const event = hurtWorldEvent(hurt as HurtEvent, {
      shard: 'phase1',
      lifeId: 'ag_kestrel_01',
      worldTick: 77,
      at,
      sequence: 1,
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe('damage');
    expect(event?.payload).toEqual({ source: 'melee', bearing: 'front', amount: 4 });
    expect(event?.agent_id).toBe('ag_kestrel_01');
  });

  it('gives two hurts in one tick different ids', () => {
    const hurt: HurtEvent = { type: 'hurt', source: 'fall', amount: 2 };
    const base = { shard: 'phase1', lifeId: 'ag_kestrel_01', worldTick: 5, at, sequence: 1 };
    const first = hurtWorldEvent(hurt, base);
    const second = hurtWorldEvent(hurt, { ...base, sequence: 2 });
    expect(first?.source_event_id).not.toBe(second?.source_event_id);
  });

  it('refuses a hurt the contract does not accept (an empty shard)', () => {
    const hurt: HurtEvent = { type: 'hurt', source: 'fall', amount: 2 };
    expect(
      hurtWorldEvent(hurt, { shard: '', lifeId: 'ag_kestrel_01', worldTick: 5, at, sequence: 1 }),
    ).toBeNull();
  });
});
