import { describe, expect, it } from 'vitest';
import { parseAdamConfig } from './adam-config.ts';

/** The shard keys the Body reads, without `body_actions`: a shard file that leaves the flag out. */
const SHARD = {
  shard: 'phase0',
  tick_rate: 20,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

describe('body_actions.edit_sign', () => {
  it('is off when the shard file has no body_actions block', () => {
    expect(parseAdamConfig(SHARD).editSign).toBe(false);
  });

  it('is off when body_actions leaves edit_sign out', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: {} }).editSign).toBe(false);
  });

  it('is off when edit_sign is false', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { edit_sign: false } }).editSign).toBe(false);
  });

  it('is on only when edit_sign is true', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { edit_sign: true } }).editSign).toBe(true);
  });

  it.each(['yes', 1, 'true', null])(
    'refuses a non-boolean value (%j) instead of guessing',
    (value) => {
      expect(() => parseAdamConfig({ ...SHARD, body_actions: { edit_sign: value } })).toThrow(
        'body_actions.edit_sign must be true or false',
      );
    },
  );
});
