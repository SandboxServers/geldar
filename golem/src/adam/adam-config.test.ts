import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';
import { parseAdamConfig } from './adam-config.ts';

/** The shard keys the Body reads, without `body_actions`: a shard file that leaves the flag out. */
const SHARD = {
  shard: 'phase0',
  tick_rate: 20,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

describe('body_actions.swim', () => {
  it('is off when the shard file has no body_actions block', () => {
    expect(parseAdamConfig(SHARD).swim).toBe(false);
  });

  it('is on only when swim is true', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { swim: true } }).swim).toBe(true);
    expect(parseAdamConfig({ ...SHARD, body_actions: { swim: false } }).swim).toBe(false);
  });

  it('refuses a swim flag that is not true or false', () => {
    expect(() => parseAdamConfig({ ...SHARD, body_actions: { swim: 'yes' } })).toThrow(
      'body_actions.swim must be true or false',
    );
  });
});

describe('body_actions.use', () => {
  it('is off when the shard file has no body_actions block', () => {
    expect(parseAdamConfig(SHARD).use).toBe(false);
  });

  it('is off when body_actions leaves use out', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { edit_sign: true } }).use).toBe(false);
  });

  it('is off when use is false', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { use: false } }).use).toBe(false);
  });

  it('is on only when use is true', () => {
    expect(parseAdamConfig({ ...SHARD, body_actions: { use: true } }).use).toBe(true);
  });

  it('refuses a use flag that is not true or false', () => {
    expect(() => parseAdamConfig({ ...SHARD, body_actions: { use: 'yes' } })).toThrow(
      'body_actions.use must be true or false',
    );
  });
});

describe('shards/colo-mind.yaml, the file the colo Body reads', () => {
  const colo = () =>
    parseAdamConfig(parse(readFileSync(join(repoRoot(), 'shards', 'colo-mind.yaml'), 'utf8')));

  it('enables the use verb', () => {
    expect(colo().use).toBe(true);
  });

  it('keeps the swim flag off: body_actions.swim is false (decision 0194)', () => {
    expect(colo().swim).toBe(false);
  });

  it('keeps edit_sign off', () => {
    expect(colo().editSign).toBe(false);
  });

  it('turns the building flag on (decision 0426; the NATS body role for geldar-plans and geldar-seen is applied by hand)', () => {
    expect(colo().building).toBe(true);
  });
});

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
