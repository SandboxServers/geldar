import { describe, expect, it } from 'vitest';
import { assertLoopback, loadGlassConfig } from './config.ts';

const env = { GELDAR_GLASS_PG_PASSWORD_FILE: '/run/secrets/glass_pg' };
const readPassword = () => 'sekrit-pw\n';

describe('the Glass configuration', () => {
  it('binds to 127.0.0.1 and reads the password from its file, trimmed', () => {
    const config = loadGlassConfig(env, readPassword);
    expect(config.host).toBe('127.0.0.1');
    expect(config.pg.password).toBe('sekrit-pw');
    expect(config.pg.user).toBe('geldar_glass');
  });

  it.each(['0.0.0.0', '::', '::1', 'localhost', '192.168.1.5'])(
    'refuses to start when the host is %s',
    (host) => {
      expect(() => loadGlassConfig({ ...env, GELDAR_GLASS_HOST: host }, readPassword)).toThrow(
        /127\.0\.0\.1 only/,
      );
    },
  );

  it('refuses any database role but geldar_glass', () => {
    const other = { ...env, GELDAR_GLASS_PG_USER: 'geldar' };
    expect(() => loadGlassConfig(other, readPassword)).toThrow(/only as geldar_glass/);
  });

  it('names the password file setting when it is missing, without a value', () => {
    expect(() => loadGlassConfig({}, readPassword)).toThrow(
      'GELDAR_GLASS_PG_PASSWORD_FILE is not set',
    );
  });

  it('assertLoopback accepts only 127.0.0.1', () => {
    expect(() => assertLoopback('127.0.0.1')).not.toThrow();
    expect(() => assertLoopback('0.0.0.0')).toThrow(/refusing to start/);
  });
});
