import { describe, expect, it } from 'vitest';
import { wearOf } from './item-wear.ts';

describe('wearOf', () => {
  it('is low below 50 percent used', () => {
    expect(wearOf({ maxDurability: 100, durabilityUsed: 0 })).toEqual({ wear: 'low' });
    expect(wearOf({ maxDurability: 100, durabilityUsed: 49 })).toEqual({ wear: 'low' });
  });

  it('is worn from 50 percent used through 89', () => {
    expect(wearOf({ maxDurability: 100, durabilityUsed: 50 })).toEqual({ wear: 'worn' });
    expect(wearOf({ maxDurability: 100, durabilityUsed: 89 })).toEqual({ wear: 'worn' });
  });

  it('is nearly_broken from 90 percent used, and stays so when fully used', () => {
    expect(wearOf({ maxDurability: 100, durabilityUsed: 90 })).toEqual({ wear: 'nearly_broken' });
    expect(wearOf({ maxDurability: 100, durabilityUsed: 100 })).toEqual({
      wear: 'nearly_broken',
    });
  });

  it('uses the percentage, not the raw count, for a tool with a large durability', () => {
    expect(wearOf({ maxDurability: 250, durabilityUsed: 124 })).toEqual({ wear: 'low' });
    expect(wearOf({ maxDurability: 250, durabilityUsed: 125 })).toEqual({ wear: 'worn' });
    expect(wearOf({ maxDurability: 250, durabilityUsed: 225 })).toEqual({ wear: 'nearly_broken' });
  });

  it('gives no wear key for a non-tool stack such as stone', () => {
    expect(wearOf({})).toEqual({});
    expect(wearOf({ maxDurability: undefined, durabilityUsed: undefined })).toEqual({});
  });

  it('gives no wear key and does not throw when durability data is missing or zero', () => {
    expect(() => wearOf({ maxDurability: 100 })).not.toThrow();
    expect(wearOf({ maxDurability: 100 })).toEqual({});
    expect(wearOf({ durabilityUsed: 5 })).toEqual({});
    expect(wearOf({ maxDurability: 0, durabilityUsed: 0 })).toEqual({});
  });
});
