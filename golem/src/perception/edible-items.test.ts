import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { isEdibleItem } from './edible-items.ts';

/** minecraft-data for the pinned 26.1 line: its food table is the game's own list of edible items. */
const registry = (createRequire(import.meta.url)('minecraft-data') as (v: string) => unknown)(
  '26.1',
) as { foodsByName: Record<string, unknown> };

describe('edible held items', () => {
  it('reads bread, potato and beef as food', () => {
    expect(isEdibleItem(registry, 'bread')).toBe(true);
    expect(isEdibleItem(registry, 'potato')).toBe(true);
    expect(isEdibleItem(registry, 'beef')).toBe(true);
    expect(isEdibleItem(registry, 'cooked_beef')).toBe(true);
  });

  it('reads wheat and seeds as not food', () => {
    expect(isEdibleItem(registry, 'wheat')).toBe(false);
    expect(isEdibleItem(registry, 'wheat_seeds')).toBe(false);
    expect(isEdibleItem(registry, 'beetroot_seeds')).toBe(false);
    expect(isEdibleItem(registry, 'melon_seeds')).toBe(false);
  });

  it('reads a non-food item, an unknown name and an inherited property as not food', () => {
    expect(isEdibleItem(registry, 'stone')).toBe(false);
    expect(isEdibleItem(registry, 'not_an_item')).toBe(false);
    expect(isEdibleItem(registry, 'constructor')).toBe(false);
  });

  it('reads nothing as food when the registry has no food table', () => {
    expect(isEdibleItem({}, 'bread')).toBe(false);
  });
});
