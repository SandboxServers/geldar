import { heardMuffledSentence } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { MUFFLED_LINE_CAP, renderMuffledLines } from './muffled.ts';

const n = (direction: string, band: string) => ({ direction, band });

describe('renderMuffledLines', () => {
  it('renders nothing for no notices', () => {
    expect(renderMuffledLines([])).toEqual([]);
  });

  it('collapses five notices in one direction to one line with the band of the nearest', () => {
    const lines = renderMuffledLines([
      n('n', 'far'),
      n('n', 'far'),
      n('n', 'mid'),
      n('n', 'near'),
      n('n', 'far'),
    ]);
    expect(lines).toEqual([heardMuffledSentence('n', 'near')]);
  });

  it('keeps overhead and below apart from the compass points', () => {
    expect(renderMuffledLines([n('overhead', 'near'), n('n', 'far')])).toEqual([
      heardMuffledSentence('overhead', 'near'),
      heardMuffledSentence('n', 'far'),
    ]);
    expect(renderMuffledLines([n('overhead', 'near'), n('below', 'near')])).toHaveLength(2);
  });

  it('caps the snapshot at three lines and keeps the nearest bands first', () => {
    expect(MUFFLED_LINE_CAP).toBe(3);
    const lines = renderMuffledLines([
      n('n', 'far'),
      n('e', 'mid'),
      n('s', 'near'),
      n('w', 'near'),
    ]);
    expect(lines).toEqual([
      heardMuffledSentence('s', 'near'),
      heardMuffledSentence('w', 'near'),
      heardMuffledSentence('e', 'mid'),
    ]);
    expect(lines).not.toContain(heardMuffledSentence('n', 'far'));
  });

  it('breaks a band tie by the direction order (n before s)', () => {
    const lines = renderMuffledLines([n('s', 'near'), n('n', 'near')]);
    expect(lines).toEqual([heardMuffledSentence('n', 'near'), heardMuffledSentence('s', 'near')]);
  });

  it('refuses an unknown direction or band: it is skipped, not shown', () => {
    expect(renderMuffledLines([n('up', 'near'), n('n', 'huge')])).toEqual([]);
  });

  it('keeps the rendered text free of digits, speaker names and the words of a chat line', () => {
    // The fixture chat line: its speaker, its coordinates and its words must never reach the text.
    const chat = { speaker: 'Ada', text: 'meet me at 100 64 -20' };
    const lines = renderMuffledLines([n('n', 'near'), n('overhead', 'far'), n('w', 'mid')]);
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^You hear a muffled voice [a-z ]+\.$/);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain(chat.speaker);
    for (const word of chat.text.split(' ').filter((w) => /[a-z]{3,}/.test(w))) {
      expect(text).not.toContain(word);
    }
  });
});
