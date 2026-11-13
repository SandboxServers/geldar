import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attackAction, bestWeapon, findTarget } from './attack.ts';
import type { ActionOutcome } from './outcome.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

const walk = vi.mocked(moveNear);

interface FakeEntity {
  id: number;
  name: string;
  position: Vec3;
  height: number;
  isValid: boolean;
}

interface FakeOptions {
  items?: string[];
  /** Swings the zombie survives; it is gone after this many. */
  hitsToKill?: number;
  zombieAt?: Vec3;
}

/** A bot with one zombie that dies after `hitsToKill` swings. */
function fakeBot(options: FakeOptions = {}) {
  const zombie: FakeEntity = {
    id: 7,
    name: 'zombie',
    position: options.zombieAt ?? new Vec3(2, 64, 0),
    height: 1.95,
    isValid: true,
  };
  let hits = 0;
  const self = { position: new Vec3(0, 64, 0) };
  const entities: Record<string, unknown> = { 7: zombie, 1: self };
  const bot = {
    entity: self,
    entities,
    heldItem: null as { name: string } | null,
    inventory: { items: () => (options.items ?? []).map((name) => ({ name, count: 1 })) },
    equip: vi.fn(async (item: { name: string }) => {
      bot.heldItem = item;
    }),
    lookAt: vi.fn(async () => undefined),
    attack: vi.fn(() => {
      hits += 1;
      if (hits >= (options.hitsToKill ?? 3)) {
        zombie.isValid = false;
        delete entities[7];
      }
    }),
    waitForTicks: vi.fn(async () => undefined),
    // The kill pickup listens for playerCollect; no drop is ever collected in these fakes.
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return { bot: bot as unknown as Bot, zombie, raw: bot };
}

function attack(bot: Bot, target = 'zombie', signal = new AbortController().signal) {
  return attackAction.run({ bot, signal, timeScale: 1 }, { do: 'attack', target });
}

function detailOf(outcome: ActionOutcome): Record<string, unknown> {
  return outcome.detail;
}

beforeEach(() => {
  walk.mockReset();
});

describe('findTarget and bestWeapon', () => {
  it('finds the nearest entity by mob name and ignores the bot itself', () => {
    const { bot } = fakeBot();
    expect(findTarget(bot, 'zombie')?.id).toBe(7);
    expect(findTarget(bot, 'skeleton')).toBeNull();
  });

  it('prefers a sword over an axe and a better material over a worse one', () => {
    const { bot } = fakeBot({ items: ['wooden_axe', 'stone_sword', 'iron_sword', 'bread'] });
    expect(bestWeapon(bot)?.name).toBe('iron_sword');
    expect(bestWeapon(fakeBot({ items: ['bread'] }).bot)).toBeNull();
  });
});

describe('attack: the approach never digs (decision 0164)', () => {
  it('walks up to an out-of-reach target with digTier false', async () => {
    const { bot } = fakeBot({ items: ['stone_sword'], zombieAt: new Vec3(20, 64, 0) });
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });
    await attack(bot);
    expect(walk.mock.calls[0]?.[3]).toMatchObject({ digTier: false });
  });
});

describe('attack action', () => {
  it('equips the best weapon, swings until the target is gone and completes', async () => {
    const { bot, raw } = fakeBot({ items: ['stone_sword', 'iron_axe'], hitsToKill: 3 });

    const outcome = await attack(bot);

    expect(outcome.status).toBe('completed');
    expect(detailOf(outcome)).toMatchObject({
      target: 'zombie',
      swings: 3,
      killed: true,
      weapon: 'stone_sword',
    });
    expect(raw.equip).toHaveBeenCalledTimes(1);
    expect(raw.attack).toHaveBeenCalledTimes(3);
    expect(walk).not.toHaveBeenCalled();
  });

  it('fights bare-handed when it carries no weapon', async () => {
    const { bot, raw } = fakeBot({ hitsToKill: 1 });
    const outcome = await attack(bot);
    expect(outcome.status).toBe('completed');
    expect(raw.equip).not.toHaveBeenCalled();
    expect(detailOf(outcome).weapon).toBeNull();
  });

  it('walks up to a target that is out of reach before it swings', async () => {
    const { bot, raw, zombie } = fakeBot({ zombieAt: new Vec3(8, 64, 0), hitsToKill: 1 });
    walk.mockImplementation(async () => {
      zombie.position = new Vec3(2, 64, 0);
      return { ok: true, distance: 6 };
    });

    const outcome = await attack(bot);

    expect(outcome.status).toBe('completed');
    expect(walk).toHaveBeenCalledTimes(1);
    expect(raw.attack).toHaveBeenCalledTimes(1);
  });

  it('fails not_found when no such entity is loaded', async () => {
    const { bot } = fakeBot();
    const outcome = await attack(bot, 'creeper');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found' });
  });

  it('reports the walk reason when the approach fails', async () => {
    const { bot, raw } = fakeBot({ zombieAt: new Vec3(8, 64, 0) });
    walk.mockResolvedValue({ ok: false, reason: 'blocked', message: 'no path' });

    const outcome = await attack(bot);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(raw.attack).not.toHaveBeenCalled();
  });

  it('is cancelled when the signal aborts mid-fight', async () => {
    const { bot, raw } = fakeBot({ hitsToKill: 100 });
    const controller = new AbortController();
    raw.waitForTicks.mockImplementation(async () => {
      controller.abort();
    });

    const outcome = await attack(bot, 'zombie', controller.signal);

    expect(outcome.status).toBe('cancelled');
    expect(raw.attack).toHaveBeenCalledTimes(1);
  });

  it('times out when the target outlives the swing limit', async () => {
    const { bot } = fakeBot({ hitsToKill: 1000 });
    const outcome = await attack(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(detailOf(outcome).swings).toBe(80);
  });
});
