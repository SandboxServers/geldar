import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { fakeBot } from '../body/body.fakes.ts';
import { loadedNeighbours } from './observed-chunks.ts';

/** A bot whose world holds exactly the listed chunk columns (as "cx,cz" keys). */
function botWithColumns(keys: string[]): Bot {
  const loaded = new Set(keys);
  const bot = fakeBot();
  Object.assign(bot, {
    world: { getColumn: (cx: number, cz: number) => (loaded.has(`${cx},${cz}`) ? {} : null) },
  });
  return bot;
}

describe('loadedNeighbours', () => {
  it('returns the loaded axis neighbours in n, e, s, w order', () => {
    const bot = botWithColumns(['5,5', '5,4', '6,5', '5,6', '4,5']);
    expect(loadedNeighbours(bot, 5, 5)).toEqual([
      { cx: 5, cz: 4, heading: 'n' },
      { cx: 6, cz: 5, heading: 'e' },
      { cx: 5, cz: 6, heading: 's' },
      { cx: 4, cz: 5, heading: 'w' },
    ]);
  });

  it('leaves out an unloaded neighbour', () => {
    const bot = botWithColumns(['0,0', '1,0', '-1,0', '0,1']);
    expect(loadedNeighbours(bot, 0, 0)).toEqual([
      { cx: 1, cz: 0, heading: 'e' },
      { cx: 0, cz: 1, heading: 's' },
      { cx: -1, cz: 0, heading: 'w' },
    ]);
  });

  it('returns nothing when no neighbour is loaded', () => {
    const bot = botWithColumns(['0,0']);
    expect(loadedNeighbours(bot, 0, 0)).toEqual([]);
  });

  it('does not count a diagonal chunk as a neighbour', () => {
    const bot = botWithColumns(['1,1', '-1,-1']);
    expect(loadedNeighbours(bot, 0, 0)).toEqual([]);
  });
});
