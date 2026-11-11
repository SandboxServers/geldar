import { describe, expect, it } from 'vitest';
import { kinoFeedSubject } from '../src/subjects.ts';

describe('kinoFeedSubject', () => {
  it('builds a five-token subject', () => {
    expect(kinoFeedSubject('main', 'steve_bot')).toBe('geldar.main.kino.steve_bot.feed');
  });

  it('rejects tokens that could widen the subject', () => {
    expect(() => kinoFeedSubject('main', 'a.b')).toThrow();
    expect(() => kinoFeedSubject('main', '>')).toThrow();
    expect(() => kinoFeedSubject('ma in', 'a')).toThrow();
  });
});
