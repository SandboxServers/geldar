import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { createBodyView } from './view.ts';

/** A bot with only the position and the dimension the view reads. */
function botAt(x: number, y: number, z: number, dimension: string): Bot {
  return {
    on: () => undefined,
    off: () => undefined,
    health: 20,
    entity: { position: { x, y, z } },
    game: { dimension },
  } as unknown as Bot;
}

describe('createBodyView: the exact position and dimension the log lines carry', () => {
  it('reads x, y and z in their own order, with the sign each has', () => {
    const view = createBodyView(botAt(12.34, 64.96, -133.27, 'minecraft:overworld'));
    expect(view.exactPosition).toEqual({ x: 12.34, y: 64.96, z: -133.27 });
  });

  it('reads the dimension of the bot', () => {
    const view = createBodyView(botAt(0, 70, 0, 'minecraft:the_nether'));
    expect(view.dimension).toBe('minecraft:the_nether');
  });
});
