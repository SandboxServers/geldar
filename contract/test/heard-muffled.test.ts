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

/** The two vertical directions: a voice straight above or below the listener (dx and dz both about 0). */
const VERTICAL = ['overhead', 'below'];

describe('heard_muffled vertical directions (decision 0199, MH-1 follow-up)', () => {
  it('accepts overhead and below in every band', () => {
    for (const direction of VERTICAL) {
      for (const band of BANDS) {
        expect(validateHeardMuffledPayload({ ...event, direction, band })).toBe(true);
      }
    }
  });

  it('rejects above, and a vertical direction with an unknown band', () => {
    expect(validateHeardMuffledPayload({ ...event, direction: 'above' })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, direction: 'overhead', band: 'close' })).toBe(
      false,
    );
  });

  it('words an overhead or below voice by its band', () => {
    expect(heardMuffledSentence('overhead', 'near')).toBe(
      'You hear a muffled voice close above you.',
    );
    expect(heardMuffledSentence('overhead', 'mid')).toBe('You hear a muffled voice above you.');
    expect(heardMuffledSentence('overhead', 'far')).toBe('You hear a muffled voice far above you.');
    expect(heardMuffledSentence('below', 'near')).toBe('You hear a muffled voice close below you.');
    expect(heardMuffledSentence('below', 'mid')).toBe('You hear a muffled voice below you.');
    expect(heardMuffledSentence('below', 'far')).toBe('You hear a muffled voice far below you.');
  });

  it('refuses above, and a vertical direction with an unknown band', () => {
    expect(() => heardMuffledSentence('above', 'near')).toThrow();
    expect(() => heardMuffledSentence('overhead', 'close')).toThrow();
    expect(() => heardMuffledSentence('below', 'constructor')).toThrow();
  });

  it('rejects coordinates, a speaker and words on an overhead or below notice', () => {
    expect(validateHeardMuffledPayload({ ...event, direction: 'overhead', x: 1 })).toBe(false);
    expect(validateHeardMuffledPayload({ ...event, direction: 'below', speaker: 'Sage' })).toBe(
      false,
    );
    expect(validateHeardMuffledPayload({ ...event, direction: 'below', words: 'hello' })).toBe(
      false,
    );
  });

  it('words the six vertical sentences with no digits and no compass words', () => {
    for (const direction of VERTICAL) {
      for (const band of BANDS) {
        const sentence = heardMuffledSentence(direction, band);
        expect(sentence).not.toMatch(/\d/);
        expect(sentence).not.toMatch(/north|south|east|west/i);
      }
    }
  });
});
