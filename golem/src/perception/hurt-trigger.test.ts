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

/** The `damage` WorldEvent for one hurt from `cause`: the Body loses 5 health to it, a bearing 'front' or 'behind'. */
function hurtEventFrom(cause: object) {
  const self = entityAt(1, 0, 0, 0);
  const bot = fakeBot(self);
  const { seen } = harness(bot);
  bot.emit('entityHurt', self, cause);
  bot.health = 15;
  bot.emit('health');
  const first = seen[0];
  if (!first) return null;
  return hurtWorldEvent(first[0], {
    shard: 'main',
    lifeId: 'ag_guard_01',
    worldTick: 100,
    at: '2026-11-13T00:00:00.000Z',
    sequence: 1,
  });
}

// Guard test (decision 0145): a hurt WorldEvent carries source, amount and an optional bearing only.
describe('hurt WorldEvent names no one (guard, decision 0145)', () => {
  it('a hit from a player has no name, username, uuid or entity id in its payload', () => {
    const player = {
      id: 7,
      type: 'player',
      name: 'Alex',
      username: 'Alex',
      uuid: 'u-7',
      position: { x: 0, z: 2 },
    };
    const event = hurtEventFrom(player);
    expect(event).not.toBeNull();
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(['amount', 'bearing', 'source']);
    expect(event?.payload).toEqual({ source: 'melee', amount: 5, bearing: 'front' });
    const text = JSON.stringify(event?.payload);
    for (const secret of ['Alex', 'u-7', 'username', 'uuid', 'name', 'entity']) {
      expect(text).not.toContain(secret);
    }
  });

  it('a hit from a mob has no name or entity id in its payload', () => {
    const zombie = { id: 9, type: 'hostile', name: 'zombie', position: { x: 0, z: -2 } };
    const event = hurtEventFrom(zombie);
    expect(event).not.toBeNull();
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(['amount', 'bearing', 'source']);
    expect(event?.payload).toEqual({ source: 'melee', amount: 5, bearing: 'behind' });
    expect(JSON.stringify(event?.payload)).not.toContain('zombie');
  });
});

describe('watchHurts: the live hurt trigger', () => {
  it('a hit from a zombie in front is a melee hurt with a bearing', () => {
    const self = entityAt(1, 0, 0, 0);
    const zombie = Object.assign(entityAt(2, 0, 2), { name: 'zombie', type: 'hostile' });
    const bot = fakeBot(self, [zombie]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, zombie);
    bot.health = 16.4;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 4 }, 77]]);
  });

  it('a zombie behind the Body, with the Body facing +z, is behind', () => {
    const self = entityAt(1, 0, 0, 0);
    const zombie = Object.assign(entityAt(2, 0, -2), { name: 'zombie', type: 'hostile' });
    const bot = fakeBot(self, [zombie]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, zombie);
    bot.health = 17;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'behind', amount: 3 }, 77]]);
  });

  it('a player cause is a melee hurt', () => {
    const self = entityAt(1, 0, 0, 0);
    const player = Object.assign(entityAt(2, 0, 2), { name: 'tester', type: 'player' });
    const bot = fakeBot(self, [player]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, player);
    bot.health = 16;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 4 }, 77]]);
  });

  it('a skeleton that shot the Body (the cause of its arrow) is named', () => {
    const self = entityAt(1, 0, 0, 0);
    const skeleton = Object.assign(entityAt(2, 0, 9), { name: 'skeleton', type: 'hostile' });
    const bot = fakeBot(self, [skeleton]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, skeleton);
    bot.health = 17;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 3 }, 77]]);
  });

  it('a llama spit names the llama (the server says it caused the damage)', () => {
    const self = entityAt(1, 0, 0);
    const llama = Object.assign(entityAt(2, 0, 2), { name: 'llama', type: 'animal' });
    const bot = fakeBot(self, [llama]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, llama);
    bot.health = 18;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 2 }, 77]]);
  });

  it('an iron golem cause is named, not filtered out as a passive mob', () => {
    const self = entityAt(1, 0, 0, 0);
    const golem = Object.assign(entityAt(2, 0, 2), { name: 'iron_golem', type: 'hostile' });
    const bot = fakeBot(self, [golem]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, golem);
    bot.health = 15;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 5 }, 77]]);
  });

  it('drowning beside a llama, with no damage cause entity, names no attacker', () => {
    const self = entityAt(1, 0, 0);
    const llama = Object.assign(entityAt(2, 0, 1), { name: 'llama', type: 'animal' });
    const bot = fakeBot(self, [llama]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self);
    bot.health = 18;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'other', amount: 2 }, 77]]);
    expect(seen[0]?.[0]).not.toHaveProperty('bearing');
  });

  it("a hostile mob beyond reach that is the cause is still named (the cause is the server's)", () => {
    const self = entityAt(1, 0, 0);
    const zombie = Object.assign(entityAt(2, 0, 10), { name: 'zombie', type: 'hostile' });
    const bot = fakeBot(self, [zombie]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, zombie);
    bot.health = 18;
    bot.emit('health');
    expect(seen).toEqual([[{ type: 'hurt', source: 'melee', bearing: 'front', amount: 2 }, 77]]);
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
    const zombie = Object.assign(entityAt(2, 0, 2), { name: 'zombie', type: 'hostile' });
    const bot = fakeBot(self, [zombie]);
    const { seen } = harness(bot);
    bot.emit('entityHurt', self, zombie);
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
