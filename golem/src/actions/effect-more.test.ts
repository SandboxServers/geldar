import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { type ActionOutcome, completed, type JsonValue } from './outcome.ts';
import type { ActionHandler, AnyActionHandler } from './registry.ts';
import { ActionRegistry, runAction } from './registry.ts';

type Stack = { name: string; count: number };
type Mob = { id: number; name: string; isValid?: boolean; health?: number; position: Vec3 };

/** A scripted bot with food, sleep state and entities besides position and items. */
function scripted(over: { food?: number; sleeping?: boolean; items?: Stack[]; mobs?: Mob[] } = {}) {
  const me = { id: 1, position: new Vec3(0, 64, 0) };
  const state = {
    entity: me,
    time: { age: 0 },
    food: over.food ?? 10,
    isSleeping: over.sleeping ?? false,
    inventory: { items: () => state.items },
    items: over.items ?? [],
    entities: Object.fromEntries([[1, me], ...(over.mobs ?? []).map((m) => [m.id, m])]) as Record<
      number,
      unknown
    >,
  };
  return state;
}

async function run(
  kind: string,
  action: Record<string, unknown>,
  bot: unknown,
  step: () => void = () => {},
  detail: Record<string, JsonValue> = {},
) {
  const registry = new ActionRegistry();
  const handler = {
    kind,
    timeoutMs: 1000,
    run: async (): Promise<ActionOutcome> => {
      step();
      return completed(detail);
    },
  } as unknown as AnyActionHandler;
  registry.register(handler as ActionHandler);
  return runAction(registry, bot as Bot, { do: kind, ...action }, { receipts: true });
}

const cow = (over: Partial<Mob> = {}): Mob => ({
  id: 7,
  name: 'cow',
  health: 10,
  position: new Vec3(1, 64, 0),
  ...over,
});

describe('effect receipts for eat', () => {
  it('food rose', async () => {
    const bot = scripted({ items: [{ name: 'bread', count: 2 }] });
    const r = await run('eat', {}, bot, () => {
      bot.food = 15;
      bot.items[0] = { name: 'bread', count: 1 };
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed', delta: { food_gained: 5 } });
  });
  it('nothing changed', async () => {
    const r = await run('eat', {}, scripted({ items: [{ name: 'bread', count: 2 }] }));
    expect(r.result.reason).toBe('no_effect');
  });
  it('full hunger is not judged', async () => {
    const r = await run('eat', {}, scripted({ food: 20 }));
    expect(r.state).toBe('completed');
  });
});

describe('effect receipts for attack', () => {
  it('target hurt', async () => {
    const mob = cow();
    const r = await run('attack', { target: 'cow' }, scripted({ mobs: [mob] }), () => {
      mob.health = 6;
    });
    expect(r.state).toBe('completed');
  });
  it('target dead and gone is tolerated', async () => {
    const bot = scripted({ mobs: [cow()] });
    const r = await run('attack', { target: 'cow' }, bot, () => {
      delete bot.entities[7];
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed', delta: { target_gone: 1 } });
  });
  it('target untouched', async () => {
    const r = await run('attack', { target: 'cow' }, scripted({ mobs: [cow()] }));
    expect(r.result.reason).toBe('no_effect');
  });
  it('no target in view before is not judged', async () => {
    const r = await run('attack', { target: 'cow' }, scripted());
    expect(r.state).toBe('completed');
  });
});

describe('effect receipts for deposit and withdraw', () => {
  const at = { x: 1, y: 64, z: 0 };
  it('deposit moved items out', async () => {
    const bot = scripted({ items: [{ name: 'stone', count: 5 }] });
    const r = await run('deposit', { at, item: 'stone', count: 5 }, bot, () => {
      bot.items.length = 0;
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed', delta: { items_lost: 5 } });
  });
  it('deposit that moved nothing', async () => {
    const bot = scripted({ items: [{ name: 'stone', count: 5 }] });
    const r = await run('deposit', { at, item: 'stone', count: 5 }, bot);
    expect(r.result.reason).toBe('no_effect');
  });
  it('withdraw brought items in', async () => {
    const bot = scripted();
    const r = await run('withdraw', { at, item: 'stone', count: 2 }, bot, () => {
      bot.items.push({ name: 'stone', count: 1 });
    });
    expect(r.result.detail).toMatchObject({ effect: 'partial', delta: { items_gained: 1 } });
  });
  it('withdraw that gained nothing', async () => {
    const r = await run('withdraw', { at, item: 'stone', count: 2 }, scripted());
    expect(r.result.reason).toBe('no_effect');
  });
});

describe('effect receipts for open, write_sign and sleep', () => {
  it('open that reported contents', async () => {
    const r = await run('open', { at: { x: 1, y: 64, z: 0 } }, scripted(), () => {}, {
      contents: [],
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed' });
  });
  it('open with no window', async () => {
    const r = await run('open', { at: { x: 1, y: 64, z: 0 } }, scripted());
    expect(r.result.reason).toBe('no_effect');
  });
  it('write_sign that used a sign', async () => {
    const bot = scripted({ items: [{ name: 'oak_sign', count: 1 }] });
    const r = await run(
      'write_sign',
      { text: 'hi' },
      bot,
      () => {
        bot.items.length = 0;
      },
      { lines: ['hi'] },
    );
    expect(r.result.detail).toMatchObject({ effect: 'changed' });
  });
  it('write_sign that used nothing', async () => {
    const bot = scripted({ items: [{ name: 'oak_sign', count: 1 }] });
    const r = await run('write_sign', { text: 'hi' }, bot, () => {}, { lines: ['hi'] });
    expect(r.result.reason).toBe('no_effect');
  });
  it('sleep that is asleep', async () => {
    const bot = scripted();
    const r = await run('sleep', {}, bot, () => {
      bot.isSleeping = true;
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed' });
  });
  it('sleep that left the body awake', async () => {
    const r = await run('sleep', {}, scripted());
    expect(r.result.reason).toBe('no_effect');
  });
  it('already asleep is not judged', async () => {
    const r = await run('sleep', {}, scripted({ sleeping: true }));
    expect(r.state).toBe('completed');
  });
});
