import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { heldCount } from './inventory-count.ts';

describe('heldCount', () => {
  it('asks the bot inventory for the item, with no metadata filter by default', () => {
    const calls: unknown[][] = [];
    const bot = {
      inventory: {
        count: (...args: unknown[]) => {
          calls.push(args);
          return 7;
        },
      },
    } as unknown as Bot;
    expect(heldCount(bot, 4)).toBe(7);
    expect(calls).toEqual([[4, null]]);
  });

  it('passes the metadata through when one is given', () => {
    const calls: unknown[][] = [];
    const bot = {
      inventory: {
        count: (...args: unknown[]) => {
          calls.push(args);
          return 0;
        },
      },
    } as unknown as Bot;
    heldCount(bot, 4, 2);
    expect(calls).toEqual([[4, 2]]);
  });
});
