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

  it('delays thoughts 60 seconds by default; 0 disables; a bad value is refused', () => {
    expect(loadGlassConfig(env, readPassword).delaySeconds).toBe(60);
    const off = { ...env, GELDAR_GLASS_DELAY_SECONDS: '0' };
    expect(loadGlassConfig(off, readPassword).delaySeconds).toBe(0);
    const bad = { ...env, GELDAR_GLASS_DELAY_SECONDS: '-1' };
    expect(() => loadGlassConfig(bad, readPassword)).toThrow(/whole number/);
  });

  it('hides living sovereign agents and stays enabled by default', () => {
    const config = loadGlassConfig(env, readPassword);
    expect(config.showLivingSovereign).toBe(false);
    expect(config.enabled).toBe(true);
  });

  it.each(['0.0.0.0', '::', '::1', 'localhost', '192.168.1.5'])(
    'refuses to start when the host is %s',
    (host) => {
      expect(() => loadGlassConfig({ ...env, GELDAR_GLASS_HOST: host }, readPassword)).toThrow(
        /127\.0\.0\.1 only/,
      );
    },
  );

  it('binds 0.0.0.0 only with the in-network opt-in, and never a LAN address', () => {
    const wide = { ...env, GELDAR_GLASS_HOST: '0.0.0.0' };
    expect(() => loadGlassConfig(wide, readPassword)).toThrow(/127\.0\.0\.1 only/);
    const optIn = { ...wide, GELDAR_IN_NETWORK_HOSTS: '1' };
    expect(loadGlassConfig(optIn, readPassword).host).toBe('0.0.0.0');
    const lan = { ...env, GELDAR_GLASS_HOST: '192.0.2.5', GELDAR_IN_NETWORK_HOSTS: '1' };
    expect(() => loadGlassConfig(lan, readPassword)).toThrow(/127\.0\.0\.1 only/);
    expect(() => assertLoopback('0.0.0.0', { GELDAR_IN_NETWORK_HOSTS: '0' })).toThrow();
  });

  it('reads Postgres at loopback, or at postgres only with the opt-in', () => {
    expect(loadGlassConfig(env, readPassword).pg.host).toBe('127.0.0.1');
    const named = { ...env, GELDAR_GLASS_PG_HOST: 'postgres' };
    expect(() => loadGlassConfig(named, readPassword)).toThrow(/GELDAR_GLASS_PG_HOST/);
    const optIn = { ...named, GELDAR_IN_NETWORK_HOSTS: '1' };
    expect(loadGlassConfig(optIn, readPassword).pg.host).toBe('postgres');
    for (const host of ['db.example.invalid', '192.0.2.7']) {
      const other = { ...env, GELDAR_GLASS_PG_HOST: host, GELDAR_IN_NETWORK_HOSTS: '1' };
      expect(() => loadGlassConfig(other, readPassword)).toThrow(/GELDAR_GLASS_PG_HOST/);
    }
  });

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
