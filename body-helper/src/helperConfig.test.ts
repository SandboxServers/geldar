import { describe, expect, it } from 'vitest';
import { type Env, loadHelperConfig, readSecret, type SecretFs } from './helperConfig.ts';

const SECRET_TEXT = 'secret-value-not-printed';

/** A fake file system: every path is root-owned and mode 0600 unless the test changes it. */
function fakeFs(mode = 0o100600, uid = 0): SecretFs {
  return {
    stat: () => ({ mode, uid }),
    read: () => `${SECRET_TEXT}\n`,
  };
}

const env: Env = {
  GELDAR_SHARD: 'colo',
  GELDAR_NATS_URL: 'nats://nats:4222',
  GELDAR_NATS_USER: 'helper',
  GELDAR_NATS_PASSWORD_FILE: '/run/secrets/nats-helper.txt',
  GELDAR_PG_HOST: 'postgres',
  GELDAR_PG_DATABASE: 'geldar',
  GELDAR_PG_USER: 'geldar_helper',
  GELDAR_PG_PASSWORD_FILE: '/run/secrets/pg-helper.txt',
  GELDAR_DOCKER_SOCKET: '/var/run/docker.sock',
  GELDAR_BODY_IMAGE: 'geldar/body:test',
  GELDAR_MC_HOST: 'velocity',
  GELDAR_MC_PORT: '25565',
  GELDAR_BODY_NATS_SECRET_HOST_PATH: '/host/secrets/nats-body.txt',
  GELDAR_BODY_SHARD_HOST_PATH: '/host/shards/colo.yaml',
  GELDAR_BODY_NANO_CPUS: '1000000000',
  GELDAR_BODY_MEMORY_BYTES: '536870912',
  GELDAR_BODY_PIDS_LIMIT: '256',
};

describe('helper config', () => {
  it('loads every value and defaults the port, the uid, the cap and the sweep interval', () => {
    const config = loadHelperConfig(env, fakeFs());
    expect(config.shard).toBe('colo');
    expect(config.pg.port).toBe(5432);
    expect(config.wiring.uid).toBe('1000');
    expect(config.cap).toBe(100);
    expect(config.sweepMinutes).toBe(10);
    expect(config.requestDeadlineMs).toBe(120_000);
    expect(config.natsPassword).toBe(SECRET_TEXT);
  });

  it('forwards GELDAR_OBSERVATIONS to the managed settings only for 1 or on (AN-50d)', () => {
    const observations = (value: string | undefined) =>
      loadHelperConfig(value === undefined ? env : { ...env, GELDAR_OBSERVATIONS: value }, fakeFs())
        .managed.observations;
    expect(observations(undefined)).toBeUndefined();
    expect(observations('1')).toBe('1');
    expect(observations('on')).toBe('on');
    for (const value of ['', '0', 'off', 'true', '1 ']) {
      expect(observations(value), `value ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it('reads the request deadline from its env name and refuses a zero one', () => {
    const set = loadHelperConfig({ ...env, GELDAR_BODY_HELPER_DEADLINE_MS: '5000' }, fakeFs());
    expect(set.requestDeadlineMs).toBe(5000);
    expect(() =>
      loadHelperConfig({ ...env, GELDAR_BODY_HELPER_DEADLINE_MS: '0' }, fakeFs()),
    ).toThrow('GELDAR_BODY_HELPER_DEADLINE_MS must be a positive whole number');
  });

  it('refuses a request deadline above the longest timer, and a sweep interval the timer cannot hold', () => {
    const top = { ...env, GELDAR_BODY_HELPER_DEADLINE_MS: '2147483647' };
    expect(loadHelperConfig(top, fakeFs()).requestDeadlineMs).toBe(2_147_483_647);
    for (const bad of ['3000000000', 'abc', '-1', '1.5', '99999999999999999999', '0']) {
      expect(() =>
        loadHelperConfig({ ...env, GELDAR_BODY_HELPER_DEADLINE_MS: bad }, fakeFs()),
      ).toThrow(
        'GELDAR_BODY_HELPER_DEADLINE_MS must be a positive whole number of at most 2147483647',
      );
    }
    expect(loadHelperConfig({ ...env, GELDAR_SWEEP_MINUTES: '35791' }, fakeFs()).sweepMinutes).toBe(
      35_791,
    );
    expect(() => loadHelperConfig({ ...env, GELDAR_SWEEP_MINUTES: '35792' }, fakeFs())).toThrow(
      'GELDAR_SWEEP_MINUTES must be a positive whole number of at most 35791',
    );
  });

  it('fails at start on a missing required name, and names the variable', () => {
    const { GELDAR_SHARD: _shard, ...without } = env;
    expect(() => loadHelperConfig(without, fakeFs())).toThrow('missing GELDAR_SHARD');
  });

  it('fails at start on a missing secret file name', () => {
    const { GELDAR_PG_PASSWORD_FILE: _file, ...without } = env;
    expect(() => loadHelperConfig(without, fakeFs())).toThrow('missing GELDAR_PG_PASSWORD_FILE');
  });

  it('refuses a world-readable secret file and does not print its value', () => {
    const error = (() => {
      try {
        loadHelperConfig(env, fakeFs(0o100644));
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(error?.message).toContain('must not be readable by group or others');
    expect(error?.message).not.toContain(SECRET_TEXT);
  });

  it('refuses a group-readable secret file, the group bit being the one that matters', () => {
    expect(() => readSecret('GELDAR_NATS_PASSWORD_FILE', '/p', fakeFs(0o100640))).toThrow(
      'must not be readable by group or others',
    );
  });

  it('refuses a secret file not owned by root', () => {
    expect(() => readSecret('GELDAR_NATS_PASSWORD_FILE', '/p', fakeFs(0o100600, 1000))).toThrow(
      'must be owned by root',
    );
  });

  it('refuses an empty secret file', () => {
    const empty: SecretFs = { stat: () => ({ mode: 0o100600, uid: 0 }), read: () => '\n' };
    expect(() => readSecret('GELDAR_PG_PASSWORD_FILE', '/p', empty)).toThrow('is empty');
  });

  it('leaves managed Bodies off by default, with no managed DB wiring and no RCON path', () => {
    const config = loadHelperConfig(env, fakeFs());
    expect(config.managed).toEqual({
      enabled: false,
      db: undefined,
      rconSecretHostPath: undefined,
    });
  });

  it('refuses a managed flag that is not 1 or 0, and treats 0 and empty as off', () => {
    expect(() => loadHelperConfig({ ...env, GELDAR_MANAGED_BODIES: 'yes' }, fakeFs())).toThrow(
      'GELDAR_MANAGED_BODIES must be 1 or 0',
    );
    expect(loadHelperConfig({ ...env, GELDAR_MANAGED_BODIES: '0' }, fakeFs()).managed.enabled).toBe(
      false,
    );
    expect(loadHelperConfig({ ...env, GELDAR_MANAGED_BODIES: '' }, fakeFs()).managed.enabled).toBe(
      false,
    );
  });

  it('refuses a relative or comma-split RCON or DB secret path, and names the variable only', () => {
    const bad = 'relative,/x';
    expect(() => loadHelperConfig({ ...env, GELDAR_RCON_SECRET_HOST_PATH: bad }, fakeFs())).toThrow(
      'GELDAR_RCON_SECRET_HOST_PATH must be an absolute path',
    );
    expect(() =>
      loadHelperConfig({ ...env, GELDAR_MANAGED_DB_SECRET_HOST_PATH: bad }, fakeFs()),
    ).toThrow('GELDAR_MANAGED_DB_SECRET_HOST_PATH must be an absolute path');
    try {
      loadHelperConfig({ ...env, GELDAR_RCON_SECRET_HOST_PATH: bad }, fakeFs());
    } catch (error) {
      expect(String(error)).not.toContain(bad);
    }
  });

  it('with the flag off, leaves the managed DB wiring unset when any of its host, role or secret path is missing', () => {
    const partial = {
      ...env,
      GELDAR_MANAGED_BODIES: '0',
      GELDAR_MANAGED_PG_HOST: 'postgres',
      GELDAR_MANAGED_PG_ROLE: 'geldar_body_host',
    };
    expect(loadHelperConfig(partial, fakeFs()).managed.db).toBeUndefined();
    const noRole = { ...env, GELDAR_MANAGED_BODIES: '0', GELDAR_MANAGED_PG_HOST: 'postgres' };
    expect(loadHelperConfig(noRole, fakeFs()).managed.db).toBeUndefined();
    const onlyPort = { ...env, GELDAR_MANAGED_BODIES: '0', GELDAR_MANAGED_PG_PORT: '6543' };
    expect(loadHelperConfig(onlyPort, fakeFs()).managed.db).toBeUndefined();
  });

  it.each([
    'GELDAR_RCON_SECRET_HOST_PATH',
    'GELDAR_MANAGED_PG_HOST',
    'GELDAR_MANAGED_PG_ROLE',
    'GELDAR_MANAGED_DB_SECRET_HOST_PATH',
  ])('with the flag on, a missing %s is a load error that names only that variable', (missing) => {
    const full: Record<string, string> = {
      ...env,
      GELDAR_MANAGED_BODIES: '1',
      GELDAR_RCON_SECRET_HOST_PATH: '/host/secrets/rcon.txt',
      GELDAR_MANAGED_PG_HOST: 'postgres',
      GELDAR_MANAGED_PG_ROLE: 'geldar_body_host',
      GELDAR_MANAGED_DB_SECRET_HOST_PATH: '/host/secrets/db-body-host.txt',
    };
    delete full[missing];
    let message = '';
    try {
      loadHelperConfig(full, fakeFs());
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(`${missing} is unset`);
    expect(message).toContain('GELDAR_MANAGED_BODIES is 1');
    expect(message).not.toContain('/host/secrets');
  });

  it('with the flag on, a managed port alone is not enough, and the port is the one optional value', () => {
    const portOnly = { ...env, GELDAR_MANAGED_BODIES: '1', GELDAR_MANAGED_PG_PORT: '6543' };
    expect(() => loadHelperConfig(portOnly, fakeFs())).toThrow(
      'GELDAR_MANAGED_BODIES is 1 but GELDAR_RCON_SECRET_HOST_PATH is unset',
    );
  });

  it('parses a complete managed config, with the port defaulting to 5432', () => {
    const config = loadHelperConfig(
      {
        ...env,
        GELDAR_MANAGED_BODIES: '1',
        GELDAR_RCON_SECRET_HOST_PATH: '/host/secrets/rcon.txt',
        GELDAR_MANAGED_PG_HOST: 'postgres',
        GELDAR_MANAGED_PG_ROLE: 'geldar_body_host',
        GELDAR_MANAGED_DB_SECRET_HOST_PATH: '/host/secrets/db-body-host.txt',
      },
      fakeFs(),
    );
    expect(config.managed).toEqual({
      enabled: true,
      rconSecretHostPath: '/host/secrets/rcon.txt',
      db: {
        host: 'postgres',
        port: '5432',
        role: 'geldar_body_host',
        secretHostPath: '/host/secrets/db-body-host.txt',
      },
    });
  });

  it('throws on a bad cap, so the helper exits before it connects', () => {
    expect(() => loadHelperConfig({ ...env, GELDAR_GLOBAL_BODY_CAP: '0' }, fakeFs())).toThrow(
      'GELDAR_GLOBAL_BODY_CAP must be a positive whole number',
    );
  });

  it('refuses a shard name that is not one subject token', () => {
    expect(() => loadHelperConfig({ ...env, GELDAR_SHARD: 'co.lo' }, fakeFs())).toThrow(
      'GELDAR_SHARD must be',
    );
  });
});
