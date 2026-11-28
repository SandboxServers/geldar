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
  mode: 'add' as const,
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

  it('adds no GELDAR_OBSERVATIONS key when the observations input is unset', () => {
    const config = managedBodyConfig(managedInput);
    expect(JSON.stringify(config)).not.toContain('GELDAR_OBSERVATIONS');
    const env = config.Env as string[];
    expect(env).toHaveLength(13);
    expect(managedBodyConfig({ ...managedInput, observations: undefined }).Env).toEqual(env);
  });

  it('forwards observations 1 and on as GELDAR_OBSERVATIONS with that value, and refuses any other', () => {
    expect((managedBodyConfig({ ...managedInput, observations: '1' }).Env as string[]).at(-1)).toBe(
      'GELDAR_OBSERVATIONS=1',
    );
    expect(
      (managedBodyConfig({ ...managedInput, observations: 'on' }).Env as string[]).at(-1),
    ).toBe('GELDAR_OBSERVATIONS=on');
    for (const value of ['0', '', 'true', '1 ', 'ON']) {
      expect(() => managedBodyConfig({ ...managedInput, observations: value })).toThrow(
        'observations is 1 or on',
      );
    }
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

  it('labels the managed Body with its validated life id (geldar.life), next to the owner and the Body label', () => {
    const labels = managedBodyConfig(managedInput).Labels as Record<string, string>;
    expect(labels).toEqual({
      'com.centurylinklabs.watchtower.enable': 'false',
      'com.geldar.stack': 'colo',
      'geldar.owner': 'own-a',
      'geldar.life': 'ag_0123456789ab',
      'geldar.managed': '1',
      [BODY_LABEL]: 'ranger',
    });
  });

  it.each(['ag_ABC', 'ag_a;rm', '', 'ag_0123456789abc'])(
    'refuses the life label value %j, so no Body is created with a bad geldar.life',
    (id) => {
      expect(() => managedBodyConfig({ ...managedInput, lifeId: id })).toThrow(
        'not a managed life id',
      );
    },
  );

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
      'GELDAR_ADMIT_MODE=add',
      'GELDAR_RCON_HOST=paper',
      'GELDAR_RCON_PORT=25575',
      'GELDAR_RCON_PASSWORD_FILE=/run/secrets/rcon',
      'GELDAR_IN_NETWORK_HOSTS=1',
    ]);
  });

  // The whole config of each mode, pinned. The modes differ only in the name, GELDAR_ADMIT_MODE and the admit label value.
  const ADMIT_ENV = (mode: string) => [
    'GELDAR_ADMIT_LIFE_ID=ag_0123456789ab',
    `GELDAR_ADMIT_MODE=${mode}`,
    'GELDAR_RCON_HOST=paper',
    'GELDAR_RCON_PORT=25575',
    'GELDAR_RCON_PASSWORD_FILE=/run/secrets/rcon',
    'GELDAR_IN_NETWORK_HOSTS=1',
  ];
  it.each([
    ['add', 'add'],
    ['remove', 'remove'],
  ] as const)('pins the full config of the %s one-shot', (mode, label) => {
    expect(admitConfig({ ...admitInput, mode })).toEqual({
      Image: 'golem-body:test',
      User: '1000:1000',
      Entrypoint: ADMIT_ENTRYPOINT,
      Env: ADMIT_ENV(mode),
      Labels: {
        'com.centurylinklabs.watchtower.enable': 'false',
        'com.geldar.stack': 'colo',
        [ADMIT_LABEL]: label,
      },
      HostConfig: ADMIT_HOST,
    });
  });

  it('gives the remove one-shot a name and label distinct from the add one-shot, and the same everything else', () => {
    const add = admitConfig({ ...admitInput, mode: 'add' });
    const remove = admitConfig({ ...admitInput, mode: 'remove' });
    expect(admitName('ag_0123456789ab', 'remove')).toBe('geldar-unadmit-ag_0123456789ab');
    expect(admitName('ag_0123456789ab', 'remove')).not.toBe(admitName('ag_0123456789ab', 'add'));
    expect(admitName('ag_0123456789ab', 'remove').startsWith(ADMIT_NAME_PREFIX)).toBe(false);
    expect((remove.Labels as Record<string, string>)[ADMIT_LABEL]).not.toBe(
      (add.Labels as Record<string, string>)[ADMIT_LABEL],
    );
    expect(remove.Env).toEqual(ADMIT_ENV('remove'));
    expect(remove.HostConfig).toEqual(add.HostConfig);
    expect(remove.Entrypoint).toEqual(add.Entrypoint);
    expect(remove.Image).toEqual(add.Image);
  });

  it('refuses any mode other than add or remove before any config exists', () => {
    expect(() => admitConfig({ ...admitInput, mode: 'op' as unknown as 'add' })).toThrow(
      'admit mode is add or remove',
    );
    expect(() => admitName('ag_0123456789ab', 'stop' as unknown as 'add')).toThrow(
      'admit mode is add or remove',
    );
  });

  it('binds only the RCON password file, read-only, and nothing else', () => {
    const host = admitConfig(admitInput).HostConfig as { Binds: string[] };
    expect(host.Binds).toEqual(['/root/secrets/rcon.txt:/run/secrets/rcon:ro']);
  });

  it('carries the admit label and not the Body label, so the cap does not count it', () => {
    const labels = admitConfig(admitInput).Labels as Record<string, string>;
    expect(labels[ADMIT_LABEL]).toBe('add');
    expect(BODY_LABEL in labels).toBe(false);
  });

  it('is not auto-removed: the engine force-removes it after the wait, so an early exit cannot race the wait into a 404', () => {
    const host = admitConfig(admitInput).HostConfig as Record<string, unknown>;
    expect(host.AutoRemove).toBeUndefined();
  });

  it('has no capability, a read-only root and no new privileges', () => {
    const host = admitConfig(admitInput).HostConfig as Record<string, unknown>;
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

// The full HostConfig of each template is pinned field by field: a mutation of any one line fails a named test.
const ADMIT_HOST = {
  NetworkMode: 'geldar-colo',
  Binds: ['/root/secrets/rcon.txt:/run/secrets/rcon:ro'],
  Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
  ReadonlyRootfs: true,
  LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } },
  CapDrop: ['ALL'],
  SecurityOpt: ['no-new-privileges:true'],
  Memory: 128 * 1024 * 1024,
  MemorySwap: 128 * 1024 * 1024,
  PidsLimit: 32,
};

const MANAGED_HOST = {
  NanoCpus: 1_000_000_000,
  Memory: 1024 * 1024 * 1024,
  MemorySwap: 1024 * 1024 * 1024,
  PidsLimit: 256,
  NetworkMode: 'geldar-colo',
  Binds: [
    '/root/secrets/nats-body.txt:/run/secrets/nats-body.txt:ro',
    '/root/shards/colo.yaml:/opt/geldar/shards/colo.yaml:ro',
    '/root/secrets/db-body-host.txt:/run/secrets/db-password.txt:ro',
  ],
  Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
  ReadonlyRootfs: true,
  LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
  RestartPolicy: { Name: 'unless-stopped' },
  CapDrop: ['ALL'],
  SecurityOpt: ['no-new-privileges:true'],
};

describe('pinned HostConfig of both templates', () => {
  const admit = admitConfig(admitInput);
  const managed = managedBodyConfig(managedInput);

  it('the admit one-shot has exactly the pinned HostConfig and nothing else', () => {
    expect(admit.HostConfig).toEqual(ADMIT_HOST);
    expect(admit.Image).toBe('golem-body:test');
    expect(admit.User).toBe('1000:1000');
  });

  it('the managed Body has exactly the pinned HostConfig and nothing else', () => {
    expect(managed.HostConfig).toEqual(MANAGED_HOST);
    expect(managed.Image).toBe('golem-body:test');
    expect(managed.User).toBe('1000:1000');
  });

  it.each(Object.entries(ADMIT_HOST))('admit HostConfig.%s is pinned', (key, value) => {
    expect((admit.HostConfig as Record<string, unknown>)[key]).toEqual(value);
  });

  it.each(Object.entries(MANAGED_HOST))('managed Body HostConfig.%s is pinned', (key, value) => {
    expect((managed.HostConfig as Record<string, unknown>)[key]).toEqual(value);
  });

  it.each(['Privileged', 'PidMode', 'AutoRemove', 'Devices', 'CapAdd'])(
    'neither template sets %s',
    (key) => {
      expect((admit.HostConfig as Record<string, unknown>)[key]).toBeUndefined();
      expect((managed.HostConfig as Record<string, unknown>)[key]).toBeUndefined();
    },
  );

  it('the admit one-shot has no restart policy, since it runs once and is removed', () => {
    expect((admit.HostConfig as Record<string, unknown>).RestartPolicy).toBeUndefined();
  });
});
