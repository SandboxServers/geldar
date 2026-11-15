import { describe, expect, it } from 'vitest';
import { parsePlayerConfig } from '../players/player-config.ts';
import { parseAdamConfig } from './adam-config.ts';

function shard(agent: Record<string, unknown>): Record<string, unknown> {
  return {
    shard: 'phase0',
    tick_rate: 10,
    mind: { agent: { username: 'ag_adam_01', name: 'Adam', ...agent } },
    chat: { rate_limit_seconds: 7, max_chars: 111 },
    reflexes: {},
  };
}

/** A shard with one sovereign player, Jason, whose entry may carry a harness and model. */
function withPlayer(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    shard: 'phase0',
    tick_rate: 10,
    mind: { agent: { username: 'ag_adam_01', name: 'Adam' }, lives: { adam: 'ag_adam_01' } },
    chat: { rate_limit_seconds: 7, max_chars: 111 },
    reflexes: {},
    sovereign: {
      presence: { start: 'always' },
      players: [{ player_id: 'ag-jason-01', life_id: 'ag_jason_01', name: 'Jason', ...entry }],
    },
  };
}

describe('the run stamp in the Adam config (GX-01b)', () => {
  it('has no stamp when harness and model are both left out (off is the old path)', () => {
    const config = parseAdamConfig(shard({}));
    expect('stamp' in config).toBe(false);
  });

  it('reads harness and model from mind.agent', () => {
    const config = parseAdamConfig(shard({ harness: 'animus', model: 'tier-large' }));
    expect(config.stamp).toEqual({ harness: 'animus', model: 'tier-large' });
  });

  it('reads one of the two when only that one is set', () => {
    expect(parseAdamConfig(shard({ harness: 'claude' })).stamp).toEqual({ harness: 'claude' });
    expect(parseAdamConfig(shard({ model: 'gpt-5' })).stamp).toEqual({ model: 'gpt-5' });
  });

  it('accepts the longest harness (32 characters) and the longest model (128)', () => {
    const harness = `a${'b'.repeat(31)}`;
    const model = `m${'x'.repeat(127)}`;
    expect(parseAdamConfig(shard({ harness, model })).stamp).toEqual({ harness, model });
  });

  it('refuses a harness that breaks the contract pattern', () => {
    expect(() => parseAdamConfig(shard({ harness: 'Claude' }))).toThrow('mind.agent.harness');
    expect(() => parseAdamConfig(shard({ harness: '1claude' }))).toThrow('mind.agent.harness');
    expect(() => parseAdamConfig(shard({ harness: `a${'b'.repeat(32)}` }))).toThrow(
      'mind.agent.harness',
    );
    expect(() => parseAdamConfig(shard({ harness: 7 }))).toThrow('mind.agent.harness');
  });

  it('refuses a model that is empty, too long, or has a space', () => {
    expect(() => parseAdamConfig(shard({ model: '' }))).toThrow('mind.agent.model');
    expect(() => parseAdamConfig(shard({ model: 'a b' }))).toThrow('mind.agent.model');
    expect(() => parseAdamConfig(shard({ model: `m${'x'.repeat(128)}` }))).toThrow(
      'mind.agent.model',
    );
  });
});

describe('the run stamp of a sovereign player (GX-01b)', () => {
  it('copies the player entry harness and model into its config', () => {
    const config = parsePlayerConfig(
      withPlayer({ harness: 'claude', model: 'claude-haiku-5-5' }),
      'ag-jason-01',
    );
    expect(config.stamp).toEqual({ harness: 'claude', model: 'claude-haiku-5-5' });
    expect(config.lifeId).toBe('ag_jason_01');
  });

  it('has no stamp when the player entry leaves both out', () => {
    expect('stamp' in parsePlayerConfig(withPlayer({}), 'ag-jason-01')).toBe(false);
  });

  it('refuses a player harness that breaks the pattern', () => {
    expect(() => parsePlayerConfig(withPlayer({ harness: 'Claude' }), 'ag-jason-01')).toThrow(
      'mind.agent.harness',
    );
  });
});
