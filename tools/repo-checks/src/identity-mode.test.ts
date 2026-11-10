import { describe, expect, it } from 'vitest';
import { checkSovereignIdentity, isShardFile } from './identity-mode.ts';

const PATH = 'shards/phase0.yaml';

describe('checkSovereignIdentity', () => {
  it('passes sovereign allowed with identity_mode watched', () => {
    const text = 'shard: phase0\nidentity_mode: watched\nsovereign:\n  allowed: true\n';
    expect(checkSovereignIdentity(PATH, text)).toEqual([]);
  });

  it('passes the scalar form with identity_mode watched', () => {
    expect(checkSovereignIdentity(PATH, 'identity_mode: watched\nsovereign: allowed\n')).toEqual(
      [],
    );
  });

  it('passes a shard that does not allow sovereign players', () => {
    expect(checkSovereignIdentity(PATH, 'identity_mode: unwatched\nsovereign: pure\n')).toEqual([]);
    expect(checkSovereignIdentity(PATH, 'sovereign:\n  allowed: false\n')).toEqual([]);
  });

  it('fails sovereign allowed with identity_mode unwatched', () => {
    const text = 'identity_mode: unwatched\nsovereign:\n  allowed: true\n';
    const problems = checkSovereignIdentity(PATH, text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(PATH);
    expect(problems[0]).toContain('sovereign');
    expect(problems[0]).toContain('identity_mode');
    expect(problems[0]).toContain('identity_mode: unwatched');
  });

  it('fails sovereign allowed with the identity_mode key missing', () => {
    const text = 'shard: phase0\nsovereign:\n  allowed: true\n';
    const problems = checkSovereignIdentity(PATH, text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('identity_mode');
    expect(problems[0]).toContain('no identity_mode key');
  });

  it('fails the scalar form with the key missing', () => {
    expect(checkSovereignIdentity(PATH, 'sovereign: allowed\n')).toHaveLength(1);
  });

  it('leaves invalid YAML to the YAML check', () => {
    expect(checkSovereignIdentity(PATH, 'sovereign: [unclosed\n')).toEqual([]);
  });
});

describe('isShardFile', () => {
  it('matches shard config files only', () => {
    expect(isShardFile('shards/phase0.yaml')).toBe(true);
    expect(isShardFile('shards/phase0.yml')).toBe(true);
    expect(isShardFile('shards/sub/phase0.yaml')).toBe(false);
    expect(isShardFile('compose/phase0.yml')).toBe(false);
  });
});
