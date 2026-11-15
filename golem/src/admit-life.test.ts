import { describe, expect, it } from 'vitest';
import { admitLifeId } from './admit-life.ts';

describe('admit-life: the one life id from the environment', () => {
  it('accepts a managed life id of 1 to 12 lower-case letters or digits after ag_', () => {
    expect(admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'ag_a' })).toBe('ag_a');
    expect(admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'ag_0123456789ab' })).toBe('ag_0123456789ab');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['upper case', 'ag_ABC'],
    ['an underscore in the id part', 'ag_a_b'],
    ['13 characters after ag_', 'ag_0123456789abc'],
    ['no ag_ prefix', 'xx_abc'],
    ['a shell metacharacter', 'ag_a;rm'],
    ['a space', 'ag_a b'],
    ['a newline', 'ag_a\n'],
  ])('refuses %s with a fixed message, without the value', (_label, value) => {
    expect(() => admitLifeId({ GELDAR_ADMIT_LIFE_ID: value })).toThrow(
      'GELDAR_ADMIT_LIFE_ID is not a managed life id',
    );
  });

  it('ignores every other variable: the id is the only input', () => {
    expect(() =>
      admitLifeId({ GELDAR_ADMIT_LIFE_ID: 'nope', GELDAR_RCON_PASSWORD_FILE: '/run/secrets/rcon' }),
    ).toThrow();
  });
});
