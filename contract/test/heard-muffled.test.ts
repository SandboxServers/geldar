import { describe, expect, it } from 'vitest';
import { heardMuffledSentence, validateHeardMuffledPayload } from '../src/index.ts';

/** The eight compass points and the three bands, as heard_sound uses them (decision 0199, MH-1). */
const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const BANDS = ['near', 'mid', 'far'];

const event = { kind: 'heard_muffled', direction: 'ne', band: 'mid' };

describe('heard_muffled event (decision 0199, MH-1)', () => {
  it('accepts every direction and band', () => {
    for (const direction of DIRECTIONS) {
      for (const band of BANDS) {
        expect(validateHeardMuffledPayload({ ...event, direction, band })).toBe(true);
      }
    }
  });

  it('rejects coordinates and a speaker', () => {
    expect(validateHeardMuffledPayload({ ...event, x: 4 })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, y: 64 })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, z: -3 })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, speaker: 'Sage' })).toBe(false);
  });

  it('rejects words, a wrong kind, a bad band or compass point, and a missing field', () => {
    expect(validateHeardMuffledPayload({ ...event, words: 'hello' })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, kind: 'heard_sound' })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, band: 'close' })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, direction: 'up' })).toBe(false);
    const { band: _band, ...noBand } = event;
    expect(validateHeardMuffledPayload(noBand)).toBe(false);
  });
});

describe('heardMuffledSentence (decision 0199, MH-1)', () => {
  it('words a muffled voice by its band and compass point', () => {
    expect(heardMuffledSentence('n', 'near')).toBe('You hear a muffled voice close to the north.');
    expect(heardMuffledSentence('ne', 'mid')).toBe('You hear a muffled voice to the northeast.');
    expect(heardMuffledSentence('w', 'far')).toBe('You hear a muffled voice far off to the west.');
  });

  it('covers all 8 by 3 combinations, each distinct, with no digits', () => {
    const sentences = new Set<string>();
    for (const direction of DIRECTIONS) {
      for (const band of BANDS) {
        const sentence = heardMuffledSentence(direction, band);
        expect(sentence.startsWith('You hear a muffled voice ')).toBe(true);
        expect(sentence).not.toMatch(/\d/);
        sentences.add(sentence);
      }
    }
    expect(sentences.size).toBe(24);
  });

  it('refuses an unknown direction or band rather than rendering it', () => {
    expect(() => heardMuffledSentence('up', 'near')).toThrow();
    expect(() => heardMuffledSentence('n', 'close')).toThrow();
    expect(() => heardMuffledSentence('constructor', 'near')).toThrow();
  });
});
