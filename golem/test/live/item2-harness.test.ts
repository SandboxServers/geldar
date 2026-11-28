import { describe, expect, it } from 'vitest';
import {
  checkMine,
  checkRow,
  checkXp,
  configRefusal,
  type Item2Target,
  item2Refusal,
  item2StackConfig,
  item2Target,
  SETUP_ROWS,
  type SeenObservation,
} from './item2-harness.ts';

const GOOD: Item2Target = {
  shard: 'scratch-item2',
  project: 'scratch-item2',
  natsUrl: 'nats://127.0.0.1:14223',
  pgUrl: 'postgresql://geldar@127.0.0.1:15433/geldar',
  mcPort: '35565',
  rconPort: '35575',
  rconPasswordFile: '/scratch/item2/rcon.txt',
  observerLife: 'ag_obsitem_01',
};
const ENV: NodeJS.ProcessEnv = { GELDAR_IT: '1', GELDAR_ITEM2: '1' };
const refuse = (patch: Partial<Item2Target>, env = ENV) => item2Refusal({ ...GOOD, ...patch }, env);

describe('item2Refusal', () => {
  it('accepts a scratch target on loopback with both flags, and localhost', () => {
    expect(item2Refusal(GOOD, ENV)).toBeNull();
    expect(refuse({ natsUrl: 'nats://localhost:14223' })).toBeNull();
  });
  it('refuses without either flag', () => {
    expect(refuse({}, { GELDAR_ITEM2: '1' })).toContain('GELDAR_IT');
    expect(refuse({}, { GELDAR_IT: '1' })).toContain('GELDAR_ITEM2');
  });
  it('refuses the live shard names, including a scratch project with a live word', () => {
    expect(refuse({ shard: 'phase0' })).toContain('refusing');
    expect(refuse({ project: 'geldar-phase0' })).toContain('refusing');
    expect(refuse({ shard: 'scratch-live' })).toContain('live shard');
    expect(refuse({ project: 'scratch-prod' })).toContain('live shard');
  });
  it('refuses a non-loopback host, an empty port and the live NATS and Postgres ports', () => {
    expect(refuse({ natsUrl: 'nats://nats.example:14223' })).toContain('loopback');
    expect(refuse({ natsUrl: 'nats://127.0.0.1:4222' })).toContain('live default');
    expect(refuse({ pgUrl: 'postgresql://g@127.0.0.1:5432/geldar' })).toContain('live default');
    expect(refuse({ natsUrl: 'nats://127.0.0.1' })).toContain('empty');
    expect(refuse({ natsUrl: 'nats://localhost' })).toContain('empty');
  });
  it('refuses any query string or fragment on the Postgres and NATS URLs', () => {
    expect(refuse({ pgUrl: `${GOOD.pgUrl}?host=live.example&port=5432` })).toContain('query');
    expect(refuse({ natsUrl: `${GOOD.natsUrl}?x=1` })).toContain('query');
    expect(refuse({ pgUrl: `${GOOD.pgUrl}#x` })).toContain('query');
  });
  it('refuses the live Minecraft and RCON ports, and a missing or bad one', () => {
    expect(refuse({ mcPort: '25565' })).toContain('Minecraft');
    expect(refuse({ rconPort: '25575' })).toContain('RCON');
    expect(refuse({ mcPort: '' })).toContain('Minecraft');
    expect(refuse({ rconPort: '70000' })).toContain('RCON');
    expect(refuse({ rconPort: '12ab' })).toContain('RCON');
  });
  it('refuses an empty or default RCON password file, with either slash', () => {
    expect(refuse({ rconPasswordFile: '' })).toContain('password file');
    const win = ['C:', 'repo', 'compose', 'secrets', 'rcon.txt'].join(String.fromCharCode(92));
    expect(refuse({ rconPasswordFile: win })).toContain('password file');
    expect(refuse({ rconPasswordFile: '/repo/compose/secrets/rcon.txt' })).toContain(
      'password file',
    );
  });
  it('refuses an observer life that is empty, malformed or an Adam life', () => {
    expect(refuse({ observerLife: '' })).toContain('observer life');
    expect(refuse({ observerLife: 'ag_adam_03' })).toContain('observer life');
    expect(refuse({ observerLife: 'Adam' })).toContain('observer life');
  });
});

describe('item2Target, item2StackConfig and configRefusal', () => {
  it('reads only ITEM2_* variables, with nothing defaulted', () => {
    expect(item2Target({})).toEqual({
      shard: '',
      project: '',
      natsUrl: '',
      pgUrl: '',
      mcPort: '',
      rconPort: '',
      rconPasswordFile: '',
      observerLife: '',
    });
    expect(item2Refusal(item2Target({}), ENV)).not.toBeNull();
    expect(item2Target({ ITEM2_MC_PORT: '35565' }).mcPort).toBe('35565');
  });
  it('builds the stack config from the target ports and NATS only', () => {
    expect(item2StackConfig(GOOD)).toEqual({
      mcHost: '127.0.0.1',
      mcPort: 35565,
      rconHost: '127.0.0.1',
      rconPort: 35575,
      rconPasswordFile: '/scratch/item2/rcon.txt',
      natsUrl: 'nats://127.0.0.1:14223',
    });
  });
  it('refuses a shard file that is not the target shard or observer life', () => {
    expect(configRefusal({ shard: GOOD.shard, lifeId: GOOD.observerLife }, GOOD)).toBeNull();
    expect(configRefusal({ shard: 'phase0', lifeId: GOOD.observerLife }, GOOD)).toContain(
      'shard file',
    );
    expect(configRefusal({ shard: GOOD.shard, lifeId: 'ag_adam_03' }, GOOD)).toContain('Body life');
  });
  it('can set up only gift and fight', () => {
    expect([...SETUP_ROWS]).toEqual(['gift', 'fight']);
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
