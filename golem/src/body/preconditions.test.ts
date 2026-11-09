import { describe, expect, it } from 'vitest';
import { fakeView } from './body.fakes.ts';
import { builtinPreconditions, PreconditionRegistry } from './preconditions.ts';

describe('PreconditionRegistry', () => {
  it('passes an empty list', () => {
    expect(new PreconditionRegistry().evaluate([], fakeView())).toEqual({ ok: true });
  });

  it('fails closed on an unknown name, even among known ones', () => {
    const registry = builtinPreconditions();
    expect(registry.evaluate(['not_on_fire', 'field_is_known'], fakeView())).toEqual({
      ok: false,
      name: 'field_is_known',
      unknown: true,
    });
  });

  it('reports the first failing name and stops there', () => {
    const registry = new PreconditionRegistry();
    const seen: string[] = [];
    registry.register('a', () => {
      seen.push('a');
      return false;
    });
    registry.register('b', () => {
      seen.push('b');
      return false;
    });
    expect(registry.evaluate(['a', 'b'], fakeView())).toEqual({
      ok: false,
      name: 'a',
      unknown: false,
    });
    expect(seen).toEqual(['a']);
  });

  it('counts a throwing check as failed', () => {
    const registry = new PreconditionRegistry();
    registry.register('boom', () => {
      throw new Error('x');
    });
    expect(registry.evaluate(['boom'], fakeView())).toEqual({
      ok: false,
      name: 'boom',
      unknown: false,
    });
  });

  it('rejects a duplicate registration', () => {
    const registry = new PreconditionRegistry();
    registry.register('a', () => true);
    expect(() => registry.register('a', () => true)).toThrow(/duplicate/);
  });

  it('seeds_available reads the inventory', () => {
    const registry = builtinPreconditions();
    const view = fakeView();
    expect(registry.evaluate(['seeds_available'], view).ok).toBe(false);
    view.inventoryCount = (item) => (item === 'wheat_seeds' ? 3 : 0);
    expect(registry.evaluate(['seeds_available'], view).ok).toBe(true);
  });

  it('the view-based built-ins follow the view', () => {
    const registry = builtinPreconditions();
    const view = fakeView({ health: 8, hunger: 10 });
    expect(registry.evaluate(['health_above_half'], view).ok).toBe(false);
    expect(registry.evaluate(['not_hungry'], view).ok).toBe(false);
    const healthy = fakeView();
    expect(registry.evaluate(['health_above_half', 'not_hungry', 'not_in_fluid'], healthy).ok).toBe(
      true,
    );
  });
});
