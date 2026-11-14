import { describe, expect, it } from 'vitest';
import {
  proficiencyPushSubject,
  proficiencyRequestSubject,
  stateWildcard,
} from '../src/subjects.ts';

describe('state subjects', () => {
  it('build the five-token request and push subjects', () => {
    expect(proficiencyRequestSubject('main', 'ag_kestrel_01')).toBe(
      'geldar.main.state.ag_kestrel_01.proficiency',
    );
    expect(proficiencyPushSubject('main', 'ag_kestrel_01')).toBe(
      'geldar.main.state.ag_kestrel_01.level',
    );
  });

  it('wildcard is exactly the state subtree', () => {
    expect(stateWildcard('main')).toBe('geldar.main.state.>');
  });

  it('every state subject has five tokens, so the sink filter geldar.*.* never matches it', () => {
    expect(proficiencyRequestSubject('main', 'ag_kestrel_01').split('.')).toHaveLength(5);
    expect(proficiencyPushSubject('main', 'ag_kestrel_01').split('.')).toHaveLength(5);
  });

  it('reject a shard or life id that could widen the subject', () => {
    expect(() => proficiencyRequestSubject('ma.in', 'ag_kestrel_01')).toThrow();
    expect(() => proficiencyRequestSubject('main', 'ag_kestrel.01')).toThrow();
    expect(() => proficiencyRequestSubject('main', 'ag_>_01')).toThrow();
    expect(() => proficiencyPushSubject('main', 'ag_kestrel_01*')).toThrow();
    expect(() => proficiencyPushSubject('ma in', 'ag_kestrel_01')).toThrow();
    expect(() => stateWildcard('*')).toThrow();
    expect(() => stateWildcard('ma.in')).toThrow();
  });
});
