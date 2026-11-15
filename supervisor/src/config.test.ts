import { describe, expect, it } from 'vitest';
import { loadSupervisorConfig } from './config.ts';

const SECRET = 'correct-horse-battery-staple';
const SECRET_FILE = '/run/secrets/supervisor_db_password';

const env: Record<string, string | undefined> = {
  SUPERVISOR_SHARD: 'phase0',
  SUPERVISOR_NATS_URL: 'nats://nats.internal:4222',
  SUPERVISOR_DB_PASSWORD_FILE: SECRET_FILE,
  POSTGRES_HOST: 'postgres',
};

const missing = (): string => {
  throw new Error('ENOENT: no such file');
};

describe('loadSupervisorConfig', () => {
  it('reads the shard, the NATS url and the database settings, with the password from the secret file', () => {
    const config = loadSupervisorConfig(env, () => `${SECRET}\n`);
    expect(config.shard).toBe('phase0');
    expect(config.natsServers).toBe('nats://nats.internal:4222');
    expect(config.db).toEqual({
      host: 'postgres',
      port: 5432,
      database: 'geldar',
      password: SECRET,
    });
  });

  it('a missing secret file stops with an error that names the variable and the path, never a value', () => {
    expect(() => loadSupervisorConfig(env, missing)).toThrow(
      `cannot read the database password file named by SUPERVISOR_DB_PASSWORD_FILE: ${SECRET_FILE}`,
    );
    try {
      loadSupervisorConfig(env, missing);
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it('an empty secret file is refused, naming the variable', () => {
    expect(() => loadSupervisorConfig(env, () => '  \n')).toThrow(
      'the database password file named by SUPERVISOR_DB_PASSWORD_FILE is empty',
    );
  });

  it('an unset variable is named', () => {
    expect(() =>
      loadSupervisorConfig({ ...env, SUPERVISOR_SHARD: undefined }, () => SECRET),
    ).toThrow('SUPERVISOR_SHARD is not set');
    expect(() =>
      loadSupervisorConfig({ ...env, SUPERVISOR_DB_PASSWORD_FILE: undefined }, () => SECRET),
    ).toThrow('SUPERVISOR_DB_PASSWORD_FILE is not set');
  });

  it('a shard id with a dot, a wildcard, whitespace or a capital is refused, naming the variable', () => {
    for (const shard of ['a.>', 'a.b', '*', '>', ' ', 'Phase0', '0phase', 'a'.repeat(33)]) {
      expect(() => loadSupervisorConfig({ ...env, SUPERVISOR_SHARD: shard }, () => SECRET)).toThrow(
        'SUPERVISOR_SHARD is not a valid shard id',
      );
    }
  });

  it('the shard ids the shard configs name are accepted', () => {
    for (const shard of ['phase0', 'colo', 'colo-mind']) {
      expect(loadSupervisorConfig({ ...env, SUPERVISOR_SHARD: shard }, () => SECRET).shard).toBe(
        shard,
      );
    }
  });

  it('a port that is not an integer from 1 to 65535 is refused, naming the variable', () => {
    for (const port of ['abc', '0', '99999', '-1', '5432.5', '1e3', '54 32']) {
      expect(() => loadSupervisorConfig({ ...env, POSTGRES_PORT: port }, () => SECRET)).toThrow(
        'POSTGRES_PORT is not a valid port',
      );
    }
  });

  it('the port bounds 1 and 65535 are accepted and the default is 5432', () => {
    expect(loadSupervisorConfig({ ...env, POSTGRES_PORT: '1' }, () => SECRET).db.port).toBe(1);
    expect(loadSupervisorConfig({ ...env, POSTGRES_PORT: '65535' }, () => SECRET).db.port).toBe(
      65535,
    );
    expect(loadSupervisorConfig(env, () => SECRET).db.port).toBe(5432);
  });
});
