import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { ActionContext } from '../actions/registry.ts';
import type { BodyRuntime } from '../body/runtime.ts';
import { cellEnvOf, cellHandlersOf } from './wire-lane.ts';

/** A bot whose block at any cell has the name and properties given (or no block when `block` is null). */
function botWith(block: { name: string; props: Record<string, unknown> } | null): Bot {
  const found = block === null ? null : { name: block.name, getProperties: () => block.props };
  return { blockAt: () => found, inventory: { items: () => [] } } as unknown as Bot;
}

describe('cellEnvOf (BLD-38b2)', () => {
  it('reads the state properties of the live block, each as a string', () => {
    const env = cellEnvOf(
      botWith({ name: 'oak_stairs', props: { facing: 'north', waterlogged: false } }),
    );
    expect(env.propsAt({ x: 0, y: 64, z: 0 })).toEqual({ facing: 'north', waterlogged: 'false' });
    expect(env.blockAt({ x: 0, y: 64, z: 0 })).toBe('oak_stairs');
  });

  it('reads no properties (null) where the chunk is not loaded', () => {
    expect(cellEnvOf(botWith(null)).propsAt({ x: 0, y: 64, z: 0 })).toBeNull();
  });
});

describe('cellHandlersOf (BLD-38b2)', () => {
  it('hands a place the block state it asks for to the runtime', async () => {
    const runAction = vi.fn(async (_action: unknown, _signal: unknown, _opts: unknown) => ({
      result: { status: 'completed' },
    }));
    const runtime = { actions: { get: () => undefined }, runAction } as unknown as BodyRuntime;
    const handlers = cellHandlersOf(runtime);
    const ctx = {
      bot: {},
      signal: new AbortController().signal,
      timeScale: 1,
      placeState: { facing: 'north' },
    } as unknown as ActionContext;
    const outcome = await handlers.place.run(ctx, {
      do: 'place',
      block: 'oak_stairs',
      at: { x: 0, y: 64, z: 0 },
    });
    expect(outcome.status).toBe('completed');
    expect(runAction.mock.calls[0]?.[2]).toEqual({ placeState: { facing: 'north' } });
  });

  it('passes no state option for a place that asks for none', async () => {
    const runAction = vi.fn(async (_action: unknown, _signal: unknown, _opts: unknown) => ({
      result: { status: 'completed' },
    }));
    const runtime = { actions: { get: () => undefined }, runAction } as unknown as BodyRuntime;
    const ctx = {
      bot: {},
      signal: new AbortController().signal,
      timeScale: 1,
    } as unknown as ActionContext;
    await cellHandlersOf(runtime).place.run(ctx, {
      do: 'place',
      block: 'stone',
      at: { x: 0, y: 64, z: 0 },
    });
    expect(runAction.mock.calls[0]?.[2]).toEqual({});
  });
});
