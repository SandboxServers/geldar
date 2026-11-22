import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { type ActionOutcome, cancelled, completed, failed } from '../actions/outcome.ts';
import { isOwnPlacement } from '../actions/own-placements.ts';
import { MESSAGE } from '../actions/place.ts';
import type { ActionContext, ActionHandler } from '../actions/registry.ts';
import { type CellEnv, type CellHandlers, doCell } from './cell-do.ts';
import type { HeldBlock } from './scaffold.ts';

/** A world and inventory the executor reads; the handlers below change it the way the game would. */
class FakeEnv implements CellEnv {
  readonly grid = new Map<string, string>();
  readonly props = new Map<string, Record<string, string>>();
  items: HeldBlock[] = [];
  names: string[] = [];

  set(x: number, y: number, z: number, name: string): void {
    this.grid.set(`${x},${y},${z}`, name);
  }

  blockAt(at: { x: number; y: number; z: number }): string | null {
    return this.grid.get(`${at.x},${at.y},${at.z}`) ?? null;
  }

  propsAt(at: { x: number; y: number; z: number }): Record<string, string> | null {
    if (this.grid.get(`${at.x},${at.y},${at.z}`) === undefined) return null;
    return this.props.get(`${at.x},${at.y},${at.z}`) ?? {};
  }

  held(): HeldBlock[] {
    return this.items;
  }

  heldNames(): string[] {
    return this.names;
  }
}

const bot = {} as unknown as Bot;
const ctx = { bot, signal: new AbortController().signal, timeScale: 1 } as unknown as ActionContext;
const AT = { x: 4, y: 64, z: 4 };

/** The fields of a place or break action the fakes read. */
interface Act {
  block?: string;
  at: { x: number; y: number; z: number };
}

function handler<K extends 'place' | 'break'>(
  kind: K,
  run: (action: Act) => ActionOutcome | Promise<ActionOutcome>,
): ActionHandler<K> & { run: ReturnType<typeof vi.fn> } {
  return {
    kind,
    timeoutMs: 1000,
    run: vi.fn(async (_ctx: unknown, action: never) => run(action)),
  } as never;
}

/** Handlers that succeed and apply their effect to the fake world. */
function working(env: FakeEnv): CellHandlers {
  const place = handler('place', (action) => {
    env.set(action.at.x, action.at.y, action.at.z, action.block ?? 'stone');
    return completed();
  });
  const dig = handler('break', (action) => {
    const was = env.blockAt(action.at) ?? 'air';
    env.set(action.at.x, action.at.y, action.at.z, 'air');
    if (was !== 'air') env.items.push({ name: dropOfName(was), count: 1 });
    return completed();
  });
  return { place, dig } as CellHandlers;
}

function dropOfName(name: string): string {
  return name === 'stone' ? 'cobblestone' : name;
}

describe('doCell codes', () => {
  it('reports done_already when the live cell already holds the target', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'air', target: 'stone' }, env, handlers);
    expect(code).toBe('done_already');
    expect(handlers.place.run).not.toHaveBeenCalled();
  });

  it('reports not_loaded when the chunk is not loaded', async () => {
    const env = new FakeEnv();
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'air', target: 'stone' }, env, handlers);
    expect(code).toBe('not_loaded');
    expect(handlers.place.run).not.toHaveBeenCalled();
  });

  it('places a planned block, verifies it and records it as the bot own placement', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'air');
    env.items = [{ name: 'stone', count: 1 }];
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'air', target: 'stone' }, env, handlers);
    expect(code).toBe('placed');
    expect(handlers.place.run).toHaveBeenCalledWith(ctx, { do: 'place', block: 'stone', at: AT });
    expect(isOwnPlacement(bot, AT)).toBe(true);
  });

  it('breaks a planned cell to air with a tool it holds', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.names = ['wooden_pickaxe'];
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'stone', target: 'air' }, env, handlers);
    expect(code).toBe('broken');
    expect(handlers.dig.run).toHaveBeenCalledWith(ctx, { do: 'break', at: AT });
    expect(handlers.place.run).not.toHaveBeenCalled();
  });

  it('a break-then-place of one item self-funds: the broken block pays for the placement', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.names = ['wooden_pickaxe'];
    const handlers = working(env);
    const code = await doCell(
      ctx,
      { at: AT, prior: 'stone', target: 'cobblestone' },
      env,
      handlers,
    );
    expect(code).toBe('placed');
    expect(handlers.dig.run).toHaveBeenCalledTimes(1);
    expect(handlers.place.run).toHaveBeenCalledTimes(1);
  });

  it('reports missing_materials before breaking when the target is not held and not yielded', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'dirt');
    env.names = ['wooden_pickaxe'];
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'dirt', target: 'stone' }, env, handlers);
    expect(code).toBe('missing_materials');
    expect(handlers.dig.run).not.toHaveBeenCalled();
    expect(env.blockAt(AT)).toBe('dirt');
  });

  it('reports no_tool before breaking a block the agent holds no tool for', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    const handlers = working(env);
    const code = await doCell(ctx, { at: AT, prior: 'stone', target: 'air' }, env, handlers);
    expect(code).toBe('no_tool');
    expect(handlers.dig.run).not.toHaveBeenCalled();
  });

  it('maps each handler failure to its one code', async () => {
    const cases: [ActionOutcome, string][] = [
      [failed('out_of_reach', 'far'), 'out_of_reach'],
      [failed('missing_materials', 'none'), 'missing_materials'],
      [failed('state_unachievable', 'no click'), 'state_unachievable'],
      [failed('timeout', 'slow'), 'timeout'],
      [failed('blocked', MESSAGE.noReference), 'no_reference'],
      [failed('blocked', MESSAGE.occupied), 'blocked'],
      [failed('not_possible', MESSAGE.notLoaded), 'not_loaded'],
      [failed('not_possible', 'bedrock'), 'unbreakable'],
      [failed('not_found', 'that block is air'), 'changed'],
      [failed('internal', 'boom'), 'refused'],
      [cancelled(), 'cancelled'],
    ];
    for (const [outcome, code] of cases) {
      const env = new FakeEnv();
      env.set(AT.x, AT.y, AT.z, 'air');
      env.items = [{ name: 'stone', count: 1 }];
      const handlers = { dig: working(env).dig, place: handler('place', () => outcome) };
      expect(await doCell(ctx, { at: AT, prior: 'air', target: 'stone' }, env, handlers)).toBe(
        code,
      );
    }
  });

  it('reports blocked when the placement completes but the block does not appear', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'air');
    env.items = [{ name: 'stone', count: 1 }];
    const handlers = { ...working(env), place: handler('place', () => completed()) };
    const fresh = { ...ctx, bot: {} as unknown as Bot } as ActionContext;
    const code = await doCell(fresh, { at: AT, prior: 'air', target: 'stone' }, env, handlers);
    expect(code).toBe('blocked');
    expect(isOwnPlacement(fresh.bot, AT)).toBe(false);
  });

  it('reports blocked when the break completes but the cell is not air', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.names = ['wooden_pickaxe'];
    const handlers = { ...working(env), dig: handler('break', () => completed()) };
    const code = await doCell(ctx, { at: AT, prior: 'stone', target: 'air' }, env, handlers);
    expect(code).toBe('blocked');
  });
});

/** A place that sets the block and the state properties it was given, whatever was asked. */
function placingProps(env: FakeEnv, props: Record<string, string>): CellHandlers {
  const place = {
    kind: 'place',
    timeoutMs: 1000,
    run: vi.fn(async (_ctx: unknown, action: Act) => {
      env.set(AT.x, AT.y, AT.z, action.block ?? 'air');
      env.props.set(`${AT.x},${AT.y},${AT.z}`, props);
      return completed();
    }),
  } as never;
  return { place, dig: handler('break', () => completed()) } as CellHandlers;
}

describe('doCell stateful targets and live priors (BLD-38b2)', () => {
  const stairs = (env: FakeEnv, facing: string): void => {
    env.set(AT.x, AT.y, AT.z, 'oak_stairs');
    env.props.set(`${AT.x},${AT.y},${AT.z}`, { facing, half: 'bottom' });
  };

  it('a stateful target is done when the live block holds each listed property', async () => {
    const env = new FakeEnv();
    stairs(env, 'north');
    const handlers = working(env);
    const target = 'oak_stairs[facing=north]';
    expect(await doCell(ctx, { at: AT, prior: 'air', target }, env, handlers)).toBe('done_already');
    expect(handlers.place.run).not.toHaveBeenCalled();
  });

  it('a stateful target whose listed property differs is not done', async () => {
    const env = new FakeEnv();
    stairs(env, 'south');
    const handlers = working(env);
    const target = 'oak_stairs[facing=north]';
    expect(await doCell(ctx, { at: AT, prior: 'air', target }, env, handlers)).toBe('changed');
    expect(handlers.place.run).not.toHaveBeenCalled();
  });

  it('places a stateful target with the state it asks for, and verifies that state', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'air');
    env.items = [{ name: 'oak_stairs', count: 1 }];
    const handlers = placingProps(env, { half: 'top' });
    const target = 'oak_stairs[half=top]';
    expect(await doCell(ctx, { at: AT, prior: 'air', target }, env, handlers)).toBe('placed');
    const sent = vi.mocked(handlers.place.run).mock.calls[0] as unknown[];
    expect((sent[0] as ActionContext).placeState).toEqual({ half: 'top' });
    expect((sent[1] as Act).block).toBe('oak_stairs');
  });

  it('reports blocked when the placed block does not hold the state asked for', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'air');
    env.items = [{ name: 'oak_stairs', count: 1 }];
    const handlers = placingProps(env, { half: 'bottom' });
    const target = 'oak_stairs[half=top]';
    expect(await doCell(ctx, { at: AT, prior: 'air', target }, env, handlers)).toBe('blocked');
  });

  it('refuses a replace to a state the block does not take before any dig', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.items = [{ name: 'oak_stairs', count: 1 }];
    env.names = ['iron_pickaxe'];
    const handlers = working(env);
    const target = 'oak_stairs[facing=north]';
    expect(await doCell(ctx, { at: AT, prior: null, target }, env, handlers)).toBe(
      'state_unachievable',
    );
    expect(handlers.dig.run).not.toHaveBeenCalled();
    expect(handlers.place.run).not.toHaveBeenCalled();
    expect(env.blockAt(AT)).toBe('stone');
  });

  it('digs and places a replace to a state the block takes', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.items = [{ name: 'oak_stairs', count: 1 }];
    env.names = ['iron_pickaxe'];
    const handlers = { ...working(env), place: placingProps(env, { half: 'top' }).place };
    const target = 'oak_stairs[half=top]';
    expect(await doCell(ctx, { at: AT, prior: null, target }, env, handlers)).toBe('placed');
    expect(handlers.dig.run).toHaveBeenCalledTimes(1);
    expect(handlers.place.run).toHaveBeenCalledTimes(1);
  });

  it('a break cell with no planned prior digs the block it finds there, read live', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.names = ['iron_pickaxe'];
    const handlers = working(env);
    expect(await doCell(ctx, { at: AT, prior: null, target: 'air' }, env, handlers)).toBe('broken');
    expect(handlers.dig.run).toHaveBeenCalledTimes(1);
    expect(env.blockAt(AT)).toBe('air');
  });

  it('a replace cell with no planned prior digs the live block, then places its target', async () => {
    const env = new FakeEnv();
    env.set(AT.x, AT.y, AT.z, 'stone');
    env.items = [{ name: 'dirt', count: 1 }];
    env.names = ['iron_pickaxe'];
    const handlers = working(env);
    expect(await doCell(ctx, { at: AT, prior: null, target: 'dirt' }, env, handlers)).toBe(
      'placed',
    );
    expect(handlers.dig.run).toHaveBeenCalledTimes(1);
    expect(handlers.place.run).toHaveBeenCalledTimes(1);
  });
});

describe('doCell stale rule', () => {
  it('skips a cell changed by a third party with changed and runs the neighbours', async () => {
    const env = new FakeEnv();
    const near = { x: 5, y: 64, z: 4 };
    env.set(AT.x, AT.y, AT.z, 'glass');
    env.set(near.x, near.y, near.z, 'air');
    env.items = [{ name: 'stone', count: 2 }];
    const handlers = working(env);
    const changed = await doCell(ctx, { at: AT, prior: 'air', target: 'stone' }, env, handlers);
    const next = await doCell(ctx, { at: near, prior: 'air', target: 'stone' }, env, handlers);
    expect(changed).toBe('changed');
    expect(env.blockAt(AT)).toBe('glass');
    expect(next).toBe('placed');
    expect(handlers.place.run).toHaveBeenCalledTimes(1);
  });
});
