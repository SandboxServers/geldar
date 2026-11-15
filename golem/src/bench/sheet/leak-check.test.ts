import { describe, expect, it } from 'vitest';
import { leakHits } from './leak-check.ts';

describe('leakHits', () => {
  it('is clean for text with no sheet number and no leak word', () => {
    expect(leakHits('the bot said hello at tick 120', [3])).toEqual([]);
  });

  it('finds a sheet number as a standalone integer', () => {
    expect(leakHits('stats: 3 and 4', [3])).toEqual(['number:3']);
  });

  it('does not count a number inside a longer number or a decimal', () => {
    expect(leakHits('tick 13, ratio 3.5, id x3y', [3])).toEqual([]);
  });

  it('finds the words sheet, roll and experiment at a word start, in any case', () => {
    expect(leakHits('Character Sheet', [1])).toEqual(['word:sheet']);
    expect(leakHits('he ROLLED twice', [1])).toEqual(['word:roll']);
    expect(leakHits('two experiments ran', [1])).toEqual(['word:experiment']);
  });

  it('does not match a word inside another word', () => {
    expect(leakHits('the control panel', [1])).toEqual([]);
  });

  it('reports every hit once, numbers first', () => {
    expect(leakHits('sheet 3 roll 3 experiment', [3, 3])).toEqual([
      'number:3',
      'word:sheet',
      'word:roll',
      'word:experiment',
    ]);
  });

  it('refuses an empty or out-of-range sheet, so a check cannot pass with nothing to look for', () => {
    expect(() => leakHits('x', [])).toThrow('at least one sheet number');
    expect(() => leakHits('x', [0])).toThrow('not an integer from 1 to 5');
    expect(() => leakHits('x', [6])).toThrow('not an integer from 1 to 5');
    expect(() => leakHits('x', [2.5])).toThrow('not an integer from 1 to 5');
  });
});
