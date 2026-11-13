import { describe, expect, it } from 'vitest';
import { blockownerChangedSubject, blockownerQuerySubject } from '../src/subjects.ts';

describe('blockowner subjects', () => {
  it('build the four-token query and changed subjects', () => {
    expect(blockownerQuerySubject('main')).toBe('geldar.main.blockowner.query');
    expect(blockownerChangedSubject('main')).toBe('geldar.main.blockowner.changed');
  });

  it('reject a shard name that could widen the subject', () => {
    expect(() => blockownerQuerySubject('ma.in')).toThrow();
    expect(() => blockownerQuerySubject('>')).toThrow();
    expect(() => blockownerChangedSubject('ma in')).toThrow();
    expect(() => blockownerChangedSubject('*')).toThrow();
  });
});
