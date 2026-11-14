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
    expect(config.cap).toEqual({ ok: true, cap: 40 });
    expect(config.sweepMinutes).toBe(10);
    expect(config.natsPassword).toBe(SECRET_TEXT);
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

  it('carries a bad cap as read, so the service refuses starts with a config error', () => {
    const config = loadHelperConfig({ ...env, GELDAR_GLOBAL_BODY_CAP: '0' }, fakeFs());
    expect(config.cap.ok).toBe(false);
  });

  it('refuses a shard name that is not one subject token', () => {
    expect(() => loadHelperConfig({ ...env, GELDAR_SHARD: 'co.lo' }, fakeFs())).toThrow(
      'GELDAR_SHARD must be',
    );
  });
});
