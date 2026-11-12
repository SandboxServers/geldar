import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { digTicksWithMargin } from './bare-hand.ts';
import { DIG_GRACE_TICKS, digGraceTicks } from './stall-recovery.ts';

/** A bot whose dig time is the real minecraft-data digTime of stone / obsidian held bare-handed. */
function botDigging(name: string): Bot {
  const registry = minecraftData('1.21.1');
  const block = registry.blocksByName[name];
  if (!block) throw new Error(`no block ${name}`);
  // Bare hand: hardness * 5 (not harvestable) seconds at 20 ticks per second, as ms.
  const ms = (block.hardness ?? 0) * 5 * 1000;
  return { targetDigBlock: { name }, digTime: () => ms } as unknown as Bot;
}

describe('digGraceTicks', () => {
  it('keeps the fixed grace for a dig whose time is unknown or short', () => {
    expect(digGraceTicks({ targetDigBlock: {} } as unknown as Bot)).toBe(DIG_GRACE_TICKS);
    expect(
      digGraceTicks({ targetDigBlock: { name: 'dirt' }, digTime: () => 750 } as unknown as Bot),
    ).toBe(DIG_GRACE_TICKS);
  });

  it('is longer than the dig for a bare-handed stone (7.5 s) and obsidian', () => {
    expect(digGraceTicks(botDigging('stone'))).toBe(
      Math.max(DIG_GRACE_TICKS, digTicksWithMargin(150)),
    );
    expect(digGraceTicks(botDigging('obsidian'))).toBeGreaterThan(5000);
  });
});
