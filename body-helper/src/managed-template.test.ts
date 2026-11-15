import { describe, expect, it } from 'vitest';
import {
  ADMIT_ENTRYPOINT,
  ADMIT_LABEL,
  ADMIT_NAME_PREFIX,
  admitConfig,
  admitName,
  MANAGED_ENTRYPOINT,
  managedBodyConfig,
} from './managed-template.ts';
import { BODY_LABEL } from './template.ts';

const WIRING = {
  shard: 'colo',
  uid: '1000',
  mcHost: 'velocity',
  mcPort: '25565',
  natsUrl: 'nats://nats:4222',
  natsUser: 'body',
  natsSecretHostPath: '/root/secrets/nats-body.txt',
  shardHostPath: '/root/shards/colo.yaml',
};
const LIMITS = { nanoCpus: 1_000_000_000, memory: 1024 * 1024 * 1024, pidsLimit: 256 };
const DB = {
  host: 'postgres',
  port: '5432',
  role: 'geldar_body_host',
  secretHostPath: '/root/secrets/db-body-host.txt',
};

const managedInput = {
  name: 'ranger',
  owner: 'own-a',
  loginName: 'Ranger',
  image: 'golem-body:test',
  wiring: WIRING,
  limits: LIMITS,
  lifeId: 'ag_0123456789ab',
  db: DB,
};

const admitInput = {
  image: 'golem-body:test',
  uid: '1000',
  network: 'geldar-colo',
  stack: 'colo',
  lifeId: 'ag_0123456789ab',
  rconSecretHostPath: '/root/secrets/rcon.txt',
};

describe('managed Body template', () => {
  it('runs the managed player host entry and no house Adam entry', () => {
    const config = managedBodyConfig(managedInput);
    expect(config.Entrypoint).toEqual(MANAGED_ENTRYPOINT);
    expect(JSON.stringify(config)).not.toContain('adam');
  });

  it('carries the life id, the login name and the narrow database role, and no RCON anything', () => {
    const config = managedBodyConfig(managedInput);
    const env = config.Env as string[];
    expect(env).toContain('GELDAR_LIFE_ID=ag_0123456789ab');
    expect(env).toContain('GELDAR_LOGIN_NAME=Ranger');
    expect(env).toContain('GELDAR_PG_USER=geldar_body_host');
    const text = JSON.stringify(config).toLowerCase();
    expect(text).not.toContain('rcon');
    expect(text).not.toContain('docker.sock');
  });

  it('passes exactly the env names the managed host reads, with in-network hosts on', () => {
    // BH-2's golem/src/players/managed-main.ts reads these names (GELDAR_PG_* for the database). A rename on either side
    // must fail here. GELDAR_IN_NETWORK_HOSTS=1 is needed because the host refuses a non-loopback MC or NATS host without it.
    const config = managedBodyConfig(managedInput);
    const env = config.Env as string[];
    expect(env.map((entry) => entry.split('=')[0])).toEqual([
      'GELDAR_LOGIN_NAME',
      'GELDAR_LIFE_ID',
      'GELDAR_SHARD',
      'GELDAR_MC_HOST',
      'GELDAR_MC_PORT',
      'GELDAR_NATS_URL',
      'GELDAR_NATS_USER',
      'GELDAR_NATS_PASSWORD_FILE',
      'GELDAR_IN_NETWORK_HOSTS',
      'GELDAR_PG_HOST',
      'GELDAR_PG_PORT',
      'GELDAR_PG_USER',
      'GELDAR_PG_PASSWORD_FILE',
    ]);
    expect(env).toContain('GELDAR_IN_NETWORK_HOSTS=1');
  });

  it('keeps the Body label so the cap counts it, and binds exactly the NATS, shard and database files', () => {
    const config = managedBodyConfig(managedInput);
    expect((config.Labels as Record<string, string>)[BODY_LABEL]).toBe('ranger');
    const binds = (config.HostConfig as { Binds: string[] }).Binds;
    expect(binds).toEqual([
      '/root/secrets/nats-body.txt:/run/secrets/nats-body.txt:ro',
      '/root/shards/colo.yaml:/opt/geldar/shards/colo.yaml:ro',
      '/root/secrets/db-body-host.txt:/run/secrets/db-password.txt:ro',
    ]);
  });

  it('refuses a life id that is not the managed shape, before any config is built', () => {
    expect(() => managedBodyConfig({ ...managedInput, lifeId: 'ag_A;rm' })).toThrow(
      'not a managed life id',
    );
  });

  it('refuses a database secret path that would split the bind string', () => {
    expect(() =>
      managedBodyConfig({ ...managedInput, db: { ...DB, secretHostPath: '/a,b:/c' } }),
    ).toThrow('bind source is not an absolute path');
  });
});

describe('admit one-shot template', () => {
  it('runs the admit entry with the life id as its only input, plus the RCON file and host', () => {
    const config = admitConfig(admitInput);
    expect(config.Entrypoint).toEqual(ADMIT_ENTRYPOINT);
    expect(config.Env).toEqual([
      'GELDAR_ADMIT_LIFE_ID=ag_0123456789ab',
      'GELDAR_RCON_HOST=paper',
      'GELDAR_RCON_PORT=25575',
      'GELDAR_RCON_PASSWORD_FILE=/run/secrets/rcon',
      'GELDAR_IN_NETWORK_HOSTS=1',
    ]);
  });

  it('binds only the RCON password file, read-only, and nothing else', () => {
    const host = admitConfig(admitInput).HostConfig as { Binds: string[] };
    expect(host.Binds).toEqual(['/root/secrets/rcon.txt:/run/secrets/rcon:ro']);
  });

  it('carries the admit label and not the Body label, so the cap does not count it', () => {
    const labels = admitConfig(admitInput).Labels as Record<string, string>;
    expect(labels[ADMIT_LABEL]).toBe('ag_0123456789ab');
    expect(BODY_LABEL in labels).toBe(false);
  });

  it('is removed on exit, with no capability, a read-only root and no new privileges', () => {
    const host = admitConfig(admitInput).HostConfig as Record<string, unknown>;
    expect(host.AutoRemove).toBe(true);
    expect(host.CapDrop).toEqual(['ALL']);
    expect(host.ReadonlyRootfs).toBe(true);
    expect(host.SecurityOpt).toEqual(['no-new-privileges:true']);
    expect(host.Privileged).toBeUndefined();
  });

  it('names the container with the fixed prefix and the validated id only', () => {
    expect(admitName('ag_0123456789ab')).toBe(`${ADMIT_NAME_PREFIX}ag_0123456789ab`);
  });

  it.each(['ag_ABC', 'ag_a_b', 'ag_0123456789abc', 'ag_a;rm', 'ag_a/../b', '', 'ag_a\n'])(
    'refuses the hostile or malformed id %j before any name or config exists',
    (id) => {
      expect(() => admitName(id)).toThrow('not a managed life id');
      expect(() => admitConfig({ ...admitInput, lifeId: id })).toThrow('not a managed life id');
    },
  );
});
