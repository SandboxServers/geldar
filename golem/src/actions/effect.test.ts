import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { judge, snapshot } from './effect.ts';
import { completed } from './outcome.ts';
import type { ActionHandler, AnyActionHandler } from './registry.ts';
import { ActionRegistry, runAction } from './registry.ts';

type Stack = { name: string; count: number };

/** A scripted bot: `step` is what the action "does" to it, run inside the handler. */
function scripted(
  start = new Vec3(0, 64, 0),
  items: Stack[] = [],
  blocks: Record<string, string> = {},
) {
  const bot = {
    entity: { position: start },
    time: { age: 0 },
    inventory: { items: () => items },
    blockAt: (p: Vec3) => {
      const name = blocks[`${p.x},${p.y},${p.z}`];
      return name === undefined ? null : { name };
    },
  };
  return { bot, items, blocks };
}

async function run(
  kind: string,
  action: Record<string, unknown>,
  bot: unknown,
  step: () => void = () => {},
  receipts = true,
) {
  const registry = new ActionRegistry();
  const handler = {
    kind,
    timeoutMs: 1000,
    run: async () => {
      step();
      return completed({});
    },
  } as unknown as AnyActionHandler;
  registry.register(handler as ActionHandler);
  return runAction(registry, bot as Bot, { do: kind, ...action }, { receipts });
}

describe('effect receipts: a completed action that changed nothing is a no_effect failure', () => {
  it('goto that stayed put', async () => {
    const { bot } = scripted();
    const r = await run('goto', { target: { x: 10, y: 64, z: 0 } }, bot);
    expect(r.state).toBe('failed');
    expect(r.result.reason).toBe('no_effect');
    expect(r.result.message).toContain('moved 0');
  });

  it('goto that moved reports moved with the delta', async () => {
    const { bot } = scripted();
    const r = await run('goto', { target: { x: 10, y: 64, z: 0 } }, bot, () => {
      bot.entity.position = new Vec3(10, 64, 0);
    });
    expect(r.state).toBe('completed');
    expect(r.result.detail).toMatchObject({ effect: 'moved', delta: { blocks_moved: 10 } });
  });

  it('goto to where the body already is is not a failure', async () => {
    const { bot } = scripted();
    const r = await run('goto', { target: { x: 0, y: 64, z: 0 } }, bot);
    expect(r.state).toBe('completed');
  });

  it('goto to a cell next to the body that did not move is not a failure (Trini)', async () => {
    const { bot } = scripted(new Vec3(-261.5, 67, 354.5));
    const r = await run('goto', { target: { x: -263, y: 67, z: 354 } }, bot);
    expect(r.state).toBe('completed');
    expect(r.result.reason).not.toBe('no_effect');
  });

  it('goto to an adjacent cell that did not move is not a failure (Zack)', async () => {
    const { bot } = scripted(new Vec3(-282.5, 69, 372.5));
    const r = await run('goto', { target: { x: -283, y: 69, z: 371 } }, bot);
    expect(r.state).toBe('completed');
    expect(r.result.reason).not.toBe('no_effect');
  });

  it('goto to an adjacent cell that settled by a tenth is not a failure (Zack, first run)', async () => {
    const { bot } = scripted(new Vec3(-281.61, 69, 372.5));
    const r = await run('goto', { target: { x: -282, y: 69, z: 371 } }, bot, () => {
      bot.entity.position = new Vec3(-281.6, 69, 372.5);
    });
    expect(r.state).toBe('completed');
  });

  it('goto five blocks away that did not move is still no_effect', async () => {
    const { bot } = scripted();
    const r = await run('goto', { target: { x: 5, y: 64, z: 0 } }, bot);
    expect(r.result.reason).toBe('no_effect');
    expect(r.result.message).toContain('moved 0');
  });

  it('mine that gained nothing', async () => {
    const { bot } = scripted();
    const r = await run('mine', { block: 'stone', count: 3 }, bot);
    expect(r.result.reason).toBe('no_effect');
    expect(r.result.message).toContain('3 items');
  });

  it('mine that gained fewer than asked is partial and completed', async () => {
    const { bot, items } = scripted();
    const r = await run('mine', { block: 'stone', count: 3 }, bot, () => {
      items.push({ name: 'cobblestone', count: 1 });
    });
    expect(r.state).toBe('completed');
    expect(r.result.detail).toMatchObject({ effect: 'partial', delta: { items_gained: 1 } });
  });

  it('place that changed no block and used no item', async () => {
    const { bot } = scripted(new Vec3(0, 64, 0), [{ name: 'stone', count: 2 }], {
      '1,64,0': 'air',
    });
    const r = await run('place', { block: 'stone', at: { x: 1, y: 64, z: 0 } }, bot);
    expect(r.result.reason).toBe('no_effect');
  });

  it('place that set the block', async () => {
    const { bot, blocks } = scripted(new Vec3(0, 64, 0), [], { '1,64,0': 'air' });
    const r = await run('place', { block: 'stone', at: { x: 1, y: 64, z: 0 } }, bot, () => {
      blocks['1,64,0'] = 'stone';
    });
    expect(r.state).toBe('completed');
    expect(r.result.detail).toMatchObject({ effect: 'changed' });
  });

  it('give that handed over nothing', async () => {
    const { bot } = scripted(new Vec3(0, 64, 0), [{ name: 'bread', count: 4 }]);
    const r = await run('give', { to: 'Ada', item: 'bread', count: 2 }, bot);
    expect(r.result.reason).toBe('no_effect');
  });

  it('give that handed over one of two is partial', async () => {
    const { bot, items } = scripted(new Vec3(0, 64, 0), [{ name: 'bread', count: 4 }]);
    const r = await run('give', { to: 'Ada', item: 'bread', count: 2 }, bot, () => {
      items[0] = { name: 'bread', count: 3 };
    });
    expect(r.result.detail).toMatchObject({ effect: 'partial', delta: { items_lost: 1 } });
  });

  it('craft that produced none of the item', async () => {
    const { bot } = scripted(new Vec3(0, 64, 0), [{ name: 'oak_planks', count: 4 }]);
    const r = await run('craft', { item: 'stick', count: 4 }, bot);
    expect(r.result.reason).toBe('no_effect');
    expect(r.result.message).toContain('stick');
  });

  it('craft that produced the item', async () => {
    const { bot, items } = scripted(new Vec3(0, 64, 0), [{ name: 'oak_planks', count: 4 }]);
    const r = await run('craft', { item: 'stick', count: 4 }, bot, () => {
      items.push({ name: 'stick', count: 4 });
    });
    expect(r.result.detail).toMatchObject({ effect: 'changed' });
  });

  it('unstick that did not move the body', async () => {
    const { bot } = scripted();
    const r = await run('unstick', {}, bot);
    expect(r.result.reason).toBe('no_effect');
  });

  it('a bot with nothing readable is not judged', async () => {
    const r = await run('mine', { block: 'stone', count: 1 }, { time: { age: 0 } });
    expect(r.state).toBe('completed');
  });

  it('judge reads only completed verbs it knows', () => {
    const s = snapshot(scripted().bot as unknown as Bot, { do: 'unstick' });
    expect(judge({ do: 'wait' } as never, s, s)).toBeUndefined();
  });
});
