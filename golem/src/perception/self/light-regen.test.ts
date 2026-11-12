import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { lightRegen, lightWord, REGEN_HINT } from './light-regen.ts';

/** A spawned bot at midday, standing in a cell with the given light; `food` sets hunger. */
function selfBot(options: { light?: number; food?: number; cell?: boolean } = {}) {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot.entity = { position: new Vec3(0.5, 64, 0.5) };
  bot.time = { timeOfDay: 6_000 };
  bot.thunderState = 0;
  bot.health = 20;
  bot.food = options.food ?? 20;
  const light = options.light ?? 15;
  bot.blockAt = () =>
    options.cell === false ? null : { light: 0, skyLight: light, boundingBox: 'empty' };
  return bot as unknown as Bot;
}

describe('lightWord', () => {
  it('is dark below 4, dim from 4 to 11, bright from 12 (the boundaries 3, 4, 11, 12)', () => {
    expect(lightWord(3)).toBe('dark');
    expect(lightWord(4)).toBe('dim');
    expect(lightWord(11)).toBe('dim');
    expect(lightWord(12)).toBe('bright');
  });

  it('covers the ends of the 0 to 15 range', () => {
    expect(lightWord(0)).toBe('dark');
    expect(lightWord(15)).toBe('bright');
  });
});

describe('lightRegen: light', () => {
  it('reports the word for the head cell', () => {
    expect(lightRegen(selfBot({ light: 3 })).light).toBe('dark');
    expect(lightRegen(selfBot({ light: 4 })).light).toBe('dim');
    expect(lightRegen(selfBot({ light: 12 })).light).toBe('bright');
  });

  it('omits light when the head cell is not loaded, and does not throw', () => {
    expect(lightRegen(selfBot({ cell: false })).light).toBeUndefined();
  });
});

describe('lightRegen: regeneration hint', () => {
  it('is present, with the exact fixed text, only while hunger is below 18', () => {
    expect(lightRegen(selfBot({ food: 17 })).regen_hint).toBe(REGEN_HINT);
    expect(REGEN_HINT).toBe(
      'Health does not regenerate naturally while hunger is low. Hunger falls over time.',
    );
  });

  it('is absent at hunger 18 and above', () => {
    expect(lightRegen(selfBot({ food: 18 })).regen_hint).toBeUndefined();
    expect(lightRegen(selfBot({ food: 20 })).regen_hint).toBeUndefined();
  });

  it('gives no advice: the text names no action to take', () => {
    expect(REGEN_HINT).not.toMatch(/\b(eat|drink|should|must|try|need)\b/i);
  });
});

describe('lightRegen: no entity', () => {
  it('returns nothing before the Body has an entity, so the stub probes keep their values', () => {
    const bot = new EventEmitter() as unknown as Bot;
    expect(lightRegen(bot)).toEqual({});
  });
});
