import { describe, expect, it } from 'vitest';
import {
  checkMine,
  checkRow,
  checkXp,
  item2Refusal,
  type SeenObservation,
} from './item2-harness.ts';

const GOOD = {
  shard: 'scratch-item2',
  project: 'scratch-item2',
  natsUrl: 'nats://127.0.0.1:14223',
  pgUrl: 'postgresql://geldar@127.0.0.1:15433/geldar',
};
const ENV = { GELDAR_IT: '1', GELDAR_ITEM2: '1' };

describe('item2Refusal', () => {
  it('accepts a scratch shard on loopback with both flags', () => {
    expect(item2Refusal(GOOD, ENV)).toBeNull();
  });
  it('refuses without either flag', () => {
    expect(item2Refusal(GOOD, { GELDAR_ITEM2: '1' })).toContain('GELDAR_IT');
    expect(item2Refusal(GOOD, { GELDAR_IT: '1' })).toContain('GELDAR_ITEM2');
  });
  it('refuses the live shard names', () => {
    expect(item2Refusal({ ...GOOD, shard: 'phase0' }, ENV)).toContain('refusing');
    expect(item2Refusal({ ...GOOD, project: 'geldar-phase0' }, ENV)).toContain('refusing');
    expect(item2Refusal({ ...GOOD, shard: 'scratch-live' }, ENV)).toContain('live shard');
  });
  it('refuses a non-loopback host and the live default ports', () => {
    expect(item2Refusal({ ...GOOD, natsUrl: 'nats://nats.example:14223' }, ENV)).toContain(
      'loopback',
    );
    expect(item2Refusal({ ...GOOD, natsUrl: 'nats://127.0.0.1:4222' }, ENV)).toContain(
      'live default',
    );
    expect(item2Refusal({ ...GOOD, pgUrl: 'postgresql://g@127.0.0.1:5432/geldar' }, ENV)).toContain(
      'live default',
    );
    expect(item2Refusal({ ...GOOD, natsUrl: 'nats://127.0.0.1' }, ENV)).toContain('empty');
  });
});

const obs = (kind: string, key = 'k:1', agent = 'ag_obs_01'): SeenObservation => ({
  agent_id: agent,
  type: 'observation',
  payload: { kind, key },
});

describe('checkRow', () => {
  it('passes one matching observation for the observer', () => {
    expect(checkRow('break', [obs('property_broken')], 'ag_obs_01', ['ag_obs_01'])).toEqual([]);
  });
  it('fails when the kind is missing or is another row', () => {
    expect(checkRow('take', [obs('property_broken')], 'ag_obs_01', [])[0]).toContain(
      'no container_taken',
    );
    expect(checkRow('fight', [], 'ag_obs_01', [])[0]).toContain('no fight_seen');
  });
  it('fails on a wrong agent, an empty key and a duplicate', () => {
    expect(checkRow('break', [obs('property_broken', 'k', 'ag_x_01')], 'ag_obs_01', [])).toContain(
      'break: event is for ag_x_01',
    );
    expect(checkRow('break', [obs('property_broken', '')], 'ag_obs_01', ['ag_obs_01'])).toContain(
      'break: no key',
    );
    const two = [obs('property_broken'), obs('property_broken')];
    expect(checkRow('break', two, 'ag_obs_01', ['ag_obs_01'])).toContain(
      'break: 2 events, expected 1',
    );
  });
  it('reports a leaked life id', () => {
    const leaky = {
      ...obs('fight_seen'),
      payload: { kind: 'fight_seen', key: 'f', who: 'ag_zed_09' },
    };
    expect(checkRow('fight', [leaky], 'ag_obs_01', ['ag_obs_01']).join()).toContain(
      'leak life id ag_zed_09',
    );
  });
  it('allows two gifts, which are two observations by design', () => {
    const two = [obs('gift_received', 'g:0'), obs('gift_received', 'g:1')];
    expect(checkRow('gift', two, 'ag_obs_01', ['ag_obs_01'])).toEqual([]);
  });
});

describe('checkXp', () => {
  it('passes one new point and one new key', () => {
    expect(checkXp({ xp: 2, evidence: ['a'] }, { xp: 3, evidence: ['a', 'b'] })).toEqual([]);
  });
  it('fails on no award and on a double award', () => {
    expect(checkXp({ xp: 2, evidence: ['a'] }, { xp: 2, evidence: ['a'] })).toHaveLength(2);
    expect(checkXp({ xp: 2, evidence: [] }, { xp: 4, evidence: ['a', 'b'] })).toHaveLength(2);
  });
});

describe('checkMine', () => {
  it('passes only an exit code of 0', () => {
    expect(checkMine(0)).toEqual([]);
    expect(checkMine(1)[0]).toContain('exited 1');
    expect(checkMine(2)).toHaveLength(1);
  });
});
