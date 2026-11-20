// CAP-4 review 1: the anvil proof runs after the window closes. The fake bot follows mineflayer 4.39.0: the rename puts
// the output in the window's copy of the inventory, and only closeWindow copies it into bot.inventory (inventory.js).
// So a check made while the window is open reads the plain stick, and these tests fail if the order is swapped.
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { renameAndVerify } from './capture-windows.ts';

const PLAIN = { name: 'stick', count: 1, customName: null };
const NAMED = { name: 'stick', count: 1, customName: { type: 'string', value: 'capture' } };
const ANVIL_WINDOW = { id: 7, type: 'minecraft:anvil', slots: [] };

type Mode = 'renames' | 'throws-open' | 'throws-closed' | 'hangs' | 'wrong-name';

/** A bot with one open anvil: `mode` picks what the rename does. Counts the closes and the inventory reads. */
function fakeAnvil(mode: Mode) {
  let open: unknown = ANVIL_WINDOW;
  let windowOutput: unknown = PLAIN;
  let inventory: unknown[] = [PLAIN];
  let closes = 0;
  let reads = 0;
  const bot = {
    get currentWindow() {
      return open;
    },
    closeWindow() {
      closes++;
      open = null;
      inventory = [windowOutput];
    },
    waitForTicks: async () => undefined,
    inventory: {
      items: () => {
        reads++;
        return inventory;
      },
    },
  };
  const rename = async (): Promise<void> => {
    if (mode === 'hangs') return new Promise<void>(() => undefined);
    if (mode === 'throws-open') throw new Error('not enough xp');
    if (mode === 'throws-closed') {
      bot.closeWindow();
      throw new Error('not enough xp');
    }
    windowOutput = mode === 'wrong-name' ? PLAIN : NAMED;
  };
  return {
    bot: bot as unknown as Bot,
    rename,
    closes: () => closes,
    reads: () => reads,
    win: ANVIL_WINDOW as unknown as Parameters<typeof renameAndVerify>[1],
  };
}

describe('renameAndVerify: the window closes before the renamed stick is read', () => {
  it('reads the named stick the close copied into the inventory', async () => {
    const fake = fakeAnvil('renames');
    await renameAndVerify(fake.bot, fake.win, 'capture', fake.rename);
    expect(fake.closes()).toBe(1);
    expect(fake.reads()).toBe(1);
  });

  it('a rename that throws with the window open closes it, rethrows, and reads nothing', async () => {
    const fake = fakeAnvil('throws-open');
    await expect(renameAndVerify(fake.bot, fake.win, 'capture', fake.rename)).rejects.toThrow(
      'not enough xp',
    );
    expect(fake.closes()).toBe(1);
    expect(fake.reads()).toBe(0);
  });

  it('a rename that closes the window itself and then throws is not closed a second time', async () => {
    const fake = fakeAnvil('throws-closed');
    await expect(renameAndVerify(fake.bot, fake.win, 'capture', fake.rename)).rejects.toThrow(
      'not enough xp',
    );
    expect(fake.closes()).toBe(1);
    expect(fake.reads()).toBe(0);
  });

  it('no named stick after the close fails INVALID, with the inventory dump', async () => {
    const fake = fakeAnvil('wrong-name');
    await expect(renameAndVerify(fake.bot, fake.win, 'capture', fake.rename)).rejects.toThrow(
      /INVALID[\s\S]*inventory after the rename/,
    );
    expect(fake.closes()).toBe(1);
    expect(fake.reads()).toBe(1);
  });

  it('a rename that never answers is abandoned after 20 s, and the window is still closed', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeAnvil('hangs');
      const run = renameAndVerify(fake.bot, fake.win, 'capture', fake.rename);
      const failed = expect(run).rejects.toThrow('anvil: rename: no answer within 20000 ms');
      await vi.advanceTimersByTimeAsync(20_000);
      await failed;
      expect(fake.closes()).toBe(1);
      expect(fake.reads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
