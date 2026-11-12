import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { lightAtHead } from './light.ts';

const DAY = 6_000;
const NIGHT = 18_000;

/** A bot with an entity standing on (0.5, 64, 0.5), a block-light and sky-light cell, and a clock. */
function lightBot(cell: { light?: number; skyLight?: number } | null, timeOfDay = DAY) {
  const seen: Vec3[] = [];
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot.entity = { position: new Vec3(0.5, 64, 0.5) };
  bot.time = { timeOfDay };
  bot.thunderState = 0;
  bot.blockAt = (at: Vec3) => {
    seen.push(at);
    return cell;
  };
  return { bot: bot as unknown as Bot, seen };
}

describe('lightAtHead', () => {
  it('reads the head cell, one eye height above the feet (y 64 feet gives cell y 65)', () => {
    const { bot, seen } = lightBot({ light: 0, skyLight: 15 });
    lightAtHead(bot);
    expect(seen).toEqual([new Vec3(0, 65, 0)]);
  });

  it('is the brighter of block light and sky light, at day', () => {
    expect(lightAtHead(lightBot({ light: 9, skyLight: 4 }).bot)).toBe(9);
    expect(lightAtHead(lightBot({ light: 2, skyLight: 13 }).bot)).toBe(13);
  });

  it('takes 11 levels off the sky light at night, so a night sky of 15 reads 4', () => {
    expect(lightAtHead(lightBot({ light: 0, skyLight: 15 }, NIGHT).bot)).toBe(4);
  });

  it('keeps block light at night (only the sky is darkened)', () => {
    expect(lightAtHead(lightBot({ light: 14, skyLight: 15 }, NIGHT).bot)).toBe(14);
  });

  it('stays within 0 to 15', () => {
    expect(lightAtHead(lightBot({ light: 0, skyLight: 0 }, NIGHT).bot)).toBe(0);
  });

  it('is null with no entity, no cell, or no light values, and never throws', () => {
    const { bot } = lightBot({ light: 5 });
    (bot as unknown as Record<string, unknown>).entity = undefined;
    expect(lightAtHead(bot)).toBeNull();
    expect(lightAtHead(lightBot(null).bot)).toBeNull();
    expect(lightAtHead(lightBot({}).bot)).toBeNull();
  });
});
