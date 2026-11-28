import { validateObservationPayload } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { FakeWorld } from '../perception.fakes.ts';
import {
  observeTake,
  type TakeContext,
  TakeKeyLru,
  type TakeProvenance,
} from './container-take.ts';

// The real contract, with the validator wrapped in a spy that calls through unless a test queues a result.
vi.mock('@geldar/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geldar/contract')>();
  return { ...actual, validateObservationPayload: vi.fn(actual.validateObservationPayload) };
});

/** A world with the Body at the origin, an owned `block` (a chest by default) at (0, 64, 2) and nothing else. */
function watched(block = 'chest'): { world: FakeWorld; bot: Bot; self: string } {
  const world = new FakeWorld();
  world.set(block, 0, 64, 2);
  const bot = asBot(world);
  return { world, bot, self: bot.username };
}

/** The Body's take context at tick 100, with a fresh LRU unless one is given. */
function ctxFor(bot: Bot, self: string, seen = new TakeKeyLru()): TakeContext {
  return { bot, tick: 100, self, seen };
}

/** Stone between the Body's eyes and the chest. */
function walled(world: FakeWorld): void {
  for (const [x, y] of [
    [0, 64],
    [0, 65],
    [1, 64],
    [1, 65],
  ] as const) {
    world.set('stone', x, y, 1);
  }
}

const asBot = (world: FakeWorld) => world.bot as unknown as Bot;

/** A player the Body can see, standing clear of the chest. */
function visiblePlayer(world: FakeWorld, username: string): void {
  world.entities[2] = { type: 'player', username, position: new Vec3(3.5, 64, 0.5) };
}

/** A take from the chest at (0, 64, 2), by `ag_chapman_01`, owned by `owner`. */
function take(owner: string | null, overrides: Partial<TakeProvenance> = {}): TakeProvenance {
  return {
    world: 'world',
    x: 0,
    y: 64,
    z: 2,
    actor: 'ag_chapman_01',
    prior_owner: owner,
    item: 'iron_ingot',
    count: 3,
    tick: 90,
    ...overrides,
  };
}

describe('observeTake', () => {
  it('the owner sees a take from its visible container, and the taker is named', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self), ctxFor(bot, self))).toEqual({
      kind: 'container_taken',
      actor: { name: 'ag_chapman_01', life: expect.any(String), basis: 'seen' },
      item: 'iron_ingot',
      count: 3,
      key: 'take:90:0:64:2:ag_chapman_01:iron_ingot',
    });
  });

  it('other-owned teaches nothing', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take('ag_kestrel_01'), ctxFor(bot, self))).toBeNull();
  });

  it('unknown container: a take with no prior owner teaches nothing', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(null), ctxFor(bot, self))).toBeNull();
  });

  it('hidden taker unattributed', () => {
    const { bot, self } = watched();
    const seen = observeTake(take(self), ctxFor(bot, self));
    expect(seen).not.toBeNull();
    expect(seen).not.toHaveProperty('actor');
    expect(seen?.kind).toBe('container_taken');
    expect(seen?.key).toBe('take:90:0:64:2:-:iron_ingot');
  });

  it('out-of-sight container is null', () => {
    const { world, bot, self } = watched();
    walled(world);
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self), ctxFor(bot, self))).toBeNull();
  });

  it('the same message twice gives one observation', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    const msg = take(self);
    expect(observeTake(msg, ctx)).not.toBeNull();
    expect(observeTake(msg, ctx)).toBeNull();
  });

  it('ownership changed mid-operation: the message prior_owner decides', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self), ctx)).not.toBeNull();
    expect(observeTake(take('ag_kestrel_01'), ctx)).toBeNull();
  });

  it('actor === self is null', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self, { actor: self }), ctxFor(bot, self))).toBeNull();
  });

  it('a non-container block teaches nothing', () => {
    const { world, bot, self } = watched();
    world.set('stone', 0, 64, 2);
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self), ctxFor(bot, self))).toBeNull();
  });

  it('no block at the cell teaches nothing', () => {
    const { bot, self } = watched();
    expect(observeTake(take(self, { x: 5, z: 5 }), ctxFor(bot, self))).toBeNull();
  });

  it('a block lookup that throws gives null and does not throw', () => {
    const { bot, self } = watched();
    bot.blockAt = (() => {
      throw new Error('chunk not loaded');
    }) as unknown as Bot['blockAt'];
    expect(observeTake(take(self), ctxFor(bot, self))).toBeNull();
  });

  it('a visible taker with a loose spelling is not named but the take is seen', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const seen = observeTake(take(self, { actor: 'Chapman' }), ctxFor(bot, self));
    expect(seen).not.toHaveProperty('actor');
    expect(seen?.kind).toBe('container_taken');
    expect(seen?.key).toBe('take:90:0:64:2:-:iron_ingot');
  });

  it('an empty actor name is unattributed, never named', () => {
    const { bot, self } = watched();
    const seen = observeTake(take(self, { actor: '' }), ctxFor(bot, self));
    expect(seen).not.toHaveProperty('actor');
    expect(seen?.kind).toBe('container_taken');
    expect(seen?.key).toBe('take:90:0:64:2:-:iron_ingot');
  });

  it.each(['chest', 'trapped_chest', 'barrel'])('a take from a %s is observed', (block) => {
    const { world, bot, self } = watched(block);
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self), ctxFor(bot, self))?.kind).toBe('container_taken');
  });

  it('an ender chest is not in the container set, so its take teaches nothing', () => {
    const { world, bot, self } = watched('ender_chest');
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self), ctxFor(bot, self))).toBeNull();
  });

  it('non-integer coordinates or tick are refused', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self, { x: 0.5 }), ctx)).toBeNull();
    expect(observeTake(take(self, { y: Number.NaN }), ctx)).toBeNull();
    expect(observeTake(take(self, { tick: 90.25 }), ctx)).toBeNull();
  });

  it('a take stamped after the current tick is refused', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    expect(observeTake(take(self, { tick: 101 }), ctxFor(bot, self))).toBeNull();
  });

  it('an empty item, or a count that is not a positive integer, is refused', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self, { item: '' }), ctx)).toBeNull();
    expect(observeTake(take(self, { count: 0 }), ctx)).toBeNull();
    expect(observeTake(take(self, { count: -2 }), ctx)).toBeNull();
    expect(observeTake(take(self, { count: 1.5 }), ctx)).toBeNull();
  });

  it('a take past the count, item length or tick bounds is refused', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self, { count: 2305 }), ctx)).toBeNull();
    expect(observeTake(take(self, { item: 'a'.repeat(65) }), ctx)).toBeNull();
    expect(observeTake(take(self, { tick: -1 }), ctx)).toBeNull();
  });

  it('far coordinates are refused for lack of a block, so this does not pin the coordinate bound', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self, { x: 30_000_001 }), ctx)).toBeNull();
    expect(observeTake(take(self, { z: -30_000_001 }), ctx)).toBeNull();
    expect(observeTake(take(self, { y: 2049 }), ctx)).toBeNull();
  });

  it('the largest count and the longest item the contract allows are observed', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const ctx = ctxFor(bot, self);
    expect(observeTake(take(self, { count: 2304 }), ctx)).not.toBeNull();
    expect(observeTake(take(self, { item: 'a'.repeat(64) }), ctx)).not.toBeNull();
  });

  it('the named and the unattributed observation both pass the contract validator', () => {
    const named = watched();
    visiblePlayer(named.world, 'ag_chapman_01');
    const withActor = observeTake(take(named.self), ctxFor(named.bot, named.self));
    expect(validateObservationPayload(withActor)).toBe(true);

    const hidden = watched();
    const unattributed = observeTake(take(hidden.self), ctxFor(hidden.bot, hidden.self));
    expect(validateObservationPayload(unattributed)).toBe(true);
  });

  it('a refused take takes no slot in the LRU', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const seen = new TakeKeyLru();
    observeTake(take('ag_kestrel_01'), ctxFor(bot, self, seen));
    expect(seen.size).toBe(0);
  });

  it('a take past the contract bounds takes no slot in the LRU', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const seen = new TakeKeyLru();
    expect(observeTake(take(self, { count: 2305 }), ctxFor(bot, self, seen))).toBeNull();
    expect(seen.size).toBe(0);
  });

  it('seen is required: a caller that omits it is a type error', () => {
    const { bot, self } = watched();
    const omitsSeen = () =>
      // @ts-expect-error seen is required, so a redelivery is never observed twice
      observeTake(take(self), { bot, tick: 100, self });
    expect(typeof omitsSeen).toBe('function');
  });
});

describe('the contract gate in observeTake', () => {
  it('a take the contract refuses is null and takes no LRU slot', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const seen = new TakeKeyLru();
    vi.mocked(validateObservationPayload).mockReturnValueOnce(false);
    expect(observeTake(take(self), ctxFor(bot, self, seen))).toBeNull();
    expect(seen.size).toBe(0);
  });

  it('a take the contract accepts is returned and takes one LRU slot', () => {
    const { world, bot, self } = watched();
    visiblePlayer(world, 'ag_chapman_01');
    const seen = new TakeKeyLru();
    vi.mocked(validateObservationPayload).mockReturnValueOnce(true);
    expect(observeTake(take(self), ctxFor(bot, self, seen))?.kind).toBe('container_taken');
    expect(seen.size).toBe(1);
  });
});

describe('TakeKeyLru', () => {
  it('a repeat is refused and an admitted key is remembered', () => {
    const seen = new TakeKeyLru();
    expect(seen.admit('take:1')).toBe(true);
    expect(seen.admit('take:1')).toBe(false);
    expect(seen.size).toBe(1);
  });

  it('holds 256 keys and forgets the least recently seen beyond that', () => {
    const seen = new TakeKeyLru();
    for (let i = 0; i < 256; i++) seen.admit(`take:${i}`);
    expect(seen.size).toBe(256);
    expect(seen.admit('take:0')).toBe(false);
    expect(seen.admit('take:256')).toBe(true);
    expect(seen.size).toBe(256);
    expect(seen.admit('take:1')).toBe(true);
  });

  it('a repeat moves its key to the front so it outlives newer keys', () => {
    const seen = new TakeKeyLru();
    for (let i = 0; i < 256; i++) seen.admit(`take:${i}`);
    seen.admit('take:0');
    seen.admit('take:256');
    expect(seen.admit('take:0')).toBe(false);
    expect(seen.admit('take:1')).toBe(true);
  });
});
