// G3-01 settings checks that need no jq: refused and accepted directory settings, the Docker pool settings, leading-zero
// ports, and the logrotate package. Every refusal stops before any call, so the apply path is not reached.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeHost, run, st } from './genesis-bootstrap-fixture';

const PACKAGES = new URL('../genesis/bootstrap-packages.sh', import.meta.url);

describe('G3-01 bootstrap settings checks', () => {
  it.each([
    ['GELDAR_STATE_DIR', '/'],
    ['GELDAR_STATE_DIR', '/var'],
    ['GELDAR_STATE_DIR', '/var/lib'],
    ['GELDAR_STATE_DIR', '/usr'],
    ['GELDAR_STATE_DIR', '/root'],
    ['GELDAR_STATE_DIR', '/home'],
    ['GELDAR_SRC_DIR', '/usr/src/geldar'],
    ['GELDAR_SRC_DIR', '/boot'],
    ['GELDAR_SRC_DIR', '/bin'],
    ['GELDAR_SRC_DIR', '/sbin'],
    ['GELDAR_SRC_DIR', '/lib'],
    ['GELDAR_SECRETS_DIR', '/etc/ssh'],
    ['GELDAR_SECRETS_DIR', '/etc/ssh/geldar'],
    ['GELDAR_TOKENS_DIR', '/etc/sudoers.d'],
    ['GELDAR_TOKENS_DIR', '/etc/sudoers.d/geldar'],
  ])('refuses the system directory %s=%s before any call', (key, value) => {
    const r = run(makeHost({ drop: [key], extra: [`${key}=${value}`] }), []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(key);
    expect(r.calls).toEqual([]);
  });

  it.each([
    ['GELDAR_STATE_DIR', '/var/lib/geldar-test'],
    ['GELDAR_SECRETS_DIR', '/etc/geldar-test/secrets-x'],
    ['GELDAR_TOKENS_DIR', '/etc/geldar-test'],
    ['GELDAR_SRC_DIR', '/opt/geldar-test/src'],
  ])('accepts the directory setting %s=%s', (key, value) => {
    expect(run(makeHost({ drop: [key], extra: [`${key}=${value}`] }), []).code).toBe(0);
  });

  it.each([['256.0.0.1/24'], ['198.51.100.0/33'], ['198.51.100.0/0'], ['999.1.1.1/24']])(
    'refuses the Docker pool base %s before any call',
    (base) => {
      const r = run(
        makeHost({ drop: ['GELDAR_DOCKER_POOL_BASE'], extra: [`GELDAR_DOCKER_POOL_BASE=${base}`] }),
        [],
      );
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('GELDAR_DOCKER_POOL_BASE');
      expect(r.calls).toEqual([]);
    },
  );

  it.each([['0'], ['33'], ['16'], ['x']])(
    'refuses the Docker pool size %s before any call (the base is /24)',
    (size) => {
      const r = run(
        makeHost({ drop: ['GELDAR_DOCKER_POOL_SIZE'], extra: [`GELDAR_DOCKER_POOL_SIZE=${size}`] }),
        [],
      );
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('GELDAR_DOCKER_POOL_SIZE');
      expect(r.calls).toEqual([]);
    },
  );

  it.each([
    ['203.0.113.0/24', '24'],
    ['198.51.100.0/24', '32'],
    ['0.0.0.0/1', '1'],
  ])('accepts the Docker pool base %s with size %s', (base, size) => {
    const host = makeHost({
      drop: ['GELDAR_DOCKER_POOL_BASE', 'GELDAR_DOCKER_POOL_SIZE'],
      extra: [`GELDAR_DOCKER_POOL_BASE=${base}`, `GELDAR_DOCKER_POOL_SIZE=${size}`],
    });
    expect(run(host, []).code).toBe(0);
  });

  it('reads BOOTSTRAP_SSH_PORT=0022 as port 22, so the SSH guard agrees with sshd on 22', () => {
    const host = makeHost({ drop: ['BOOTSTRAP_SSH_PORT'], extra: ['BOOTSTRAP_SSH_PORT=0022'] });
    writeFileSync(st(host, 'sshd-config'), 'port 22\n');
    const r = run(host, []);
    expect(r.code).toBe(0);
    expect(r.out).toContain('effective TCP ports: 22,25565');
    expect(r.out).not.toContain('WARNING');
  });

  it('reads a leading-zero entry in GELDAR_PUBLIC_TCP_PORTS as its value', () => {
    const host = makeHost({
      drop: ['GELDAR_PUBLIC_TCP_PORTS'],
      extra: ['GELDAR_PUBLIC_TCP_PORTS=00022,25565'],
    });
    expect(run(host, []).out).toContain('effective TCP ports: 22,25565');
  });

  it.each([
    ['BOOTSTRAP_SSH_PORT', '00000'],
    ['GELDAR_PUBLIC_TCP_PORTS', '065536'],
  ])('refuses %s=%s with leading zeros before any call', (key, value) => {
    const r = run(makeHost({ drop: [key], extra: [`${key}=${value}`] }), []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('TCP port');
    expect(r.calls).toEqual([]);
  });

  it('names logrotate in the base package list', () => {
    const m = /^BASE_PACKAGES="([^"]*)"/m.exec(readFileSync(PACKAGES, 'utf8'));
    expect(m?.[1].split(' ')).toContain('logrotate');
  });
});
