// CAP-4: the anvil rename check reads the custom name whatever shape the item carries it in. Every fixture here is
// hand-built to the shapes prismarine-item (pinned in golem) can return (no server, no bot): the `customName` getter value for the
// components era (an NBT string tag, a JSON text component, a plain string) and the legacy `nbt.display.Name` tag.
import { describe, expect, it } from 'vitest';
import {
  customNameOf,
  dumpSlots,
  findRenamedStick,
  type ItemLike,
  textOf,
} from './capture-anvil.ts';

/** A renamed stick in the components era: the getter returns the NBT string tag of the custom_name component. */
const tagStick: ItemLike = {
  name: 'stick',
  count: 1,
  customName: { type: 'string', value: 'capture' },
};
/** The same stick with the getter returning a plain string (a simplified value). */
const plainStick: ItemLike = { name: 'stick', count: 1, customName: 'capture' };
/** A JSON text component, as some server versions store the name. */
const jsonStick: ItemLike = { name: 'stick', count: 1, customName: '{"text":"capture"}' };
/** The legacy shape: no component, the name in `nbt.value.display.value.Name` (a text component string). */
const legacyStick: ItemLike = {
  name: 'stick',
  count: 1,
  customName: null,
  nbt: {
    type: 'compound',
    value: {
      display: {
        type: 'compound',
        value: { Name: { type: 'string', value: '{"text":"capture"}' } },
      },
    },
  },
};
/** A plain stick, never renamed. */
const bareStick: ItemLike = { name: 'stick', count: 1, customName: undefined };
/** A stick whose name only contains the target: a substring match would wrongly accept it. */
const lookalike: ItemLike = { name: 'stick', count: 1, customName: 'capture2' };
/** A paper with the right name: the item must be a stick. */
const paper: ItemLike = { name: 'paper', count: 1, customName: 'capture' };

describe('customNameOf reads the custom name in every shape', () => {
  it('reads the NBT string tag of the components era', () => {
    expect(customNameOf(tagStick)).toBe('capture');
  });

  it('reads a plain string value', () => {
    expect(customNameOf(plainStick)).toBe('capture');
  });

  it('reads a JSON text component, with its extra parts', () => {
    expect(customNameOf(jsonStick)).toBe('capture');
    expect(customNameOf({ customName: '{"text":"cap","extra":[{"text":"ture"}]}' })).toBe(
      'capture',
    );
  });

  it('falls back to the legacy nbt display Name when there is no component', () => {
    expect(customNameOf(legacyStick)).toBe('capture');
  });

  it('is null for an item with no custom name', () => {
    expect(customNameOf(bareStick)).toBeNull();
    expect(customNameOf({ name: 'stick', customName: null, nbt: null })).toBeNull();
  });

  it('keeps a text that is not JSON as it is', () => {
    expect(textOf('{not json')).toBe('{not json');
  });
});

describe('findRenamedStick accepts only a stick with exactly the given name', () => {
  it('finds the renamed stick in each shape', () => {
    for (const item of [tagStick, plainStick, jsonStick, legacyStick]) {
      expect(findRenamedStick([bareStick, item], 'capture')).toBe(item);
    }
  });

  it('refuses an unrenamed stick, a lookalike name, and a non-stick item with the name', () => {
    expect(findRenamedStick([bareStick, lookalike, paper], 'capture')).toBeUndefined();
  });

  it('refuses an empty inventory and skips empty slots', () => {
    expect(findRenamedStick([], 'capture')).toBeUndefined();
    expect(findRenamedStick([null, undefined, tagStick], 'capture')).toBe(tagStick);
  });
});

describe('dumpSlots prints each slot with the raw custom name for the shape proof', () => {
  it('lists the items and skips empty slots', () => {
    const lines = dumpSlots('anvil', [null, tagStick, undefined, paper]);
    expect(lines[0]).toBe('anvil: 4 slots');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('slot 1: stick x1 customName="capture"');
    expect(lines[1]).toContain('raw={"type":"string","value":"capture"}');
    expect(lines[2]).toContain('slot 3: paper x1 customName="capture"');
  });

  it('prints a bigint raw value without throwing', () => {
    const lines = dumpSlots('inv', [{ name: 'stick', count: 1, customName: { value: BigInt(7) } }]);
    expect(lines[1]).toContain('raw={"value":"7"}');
  });
});
