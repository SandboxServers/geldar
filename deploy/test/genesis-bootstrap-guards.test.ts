// G3-01 guards that genesis-bootstrap.test.ts does not reach: directory modes and owners, the uid refusal, the ss
// fallback for the sshd port, nftables enablement, and the compose v2 check. Same stubs as the main file. Tests marked
// jqTest need jq (the apply runs the docker step, which merges daemon.json with it).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attrFile, jqTest, makeHost, mutating, run, st } from './genesis-bootstrap-fixture';

describe('G3-01 bootstrap guards', () => {
  jqTest('sets state 750 and secrets and tokens 700, all owned by the service uid', () => {
    const host = makeHost();
    expect(run(host, ['--apply']).code).toBe(0);
    const attrs = (dir: string) => readFileSync(attrFile(host, dir), 'utf8');
    const state = join(host.root, 'var/lib/geldar-test');
    expect(attrs(state)).toBe('750 1000:1000');
    expect(attrs(join(state, 'logs'))).toBe('750 1000:1000');
    expect(attrs(join(host.root, 'etc/geldar-test/secrets'))).toBe('700 1000:1000');
    expect(attrs(join(host.root, 'etc/geldar-test/tokens'))).toBe('700 1000:1000');
  });

  jqTest('the source directory is 755 and owned by root (0:0), as the script sets it', () => {
    const host = makeHost();
    expect(run(host, ['--apply']).code).toBe(0);
    expect(readFileSync(attrFile(host, join(host.root, 'opt/geldar-test/src')), 'utf8')).toBe(
      '755 0:0',
    );
  });

  it('refuses an existing user whose uid differs from the environment, and never runs useradd for it', () => {
    const host = makeHost();
    writeFileSync(st(host, 'users', 'geldar'), '1500 1000\n');
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('user geldar has uid 1500 but the environment says 1000');
    expect(r.calls.some((c) => c.startsWith('useradd'))).toBe(false);
  });

  it('reads the sshd port from ss when sshd -T prints none, and dies before any rule on that port', () => {
    const host = makeHost();
    writeFileSync(st(host, 'sshd-fail'), '');
    writeFileSync(st(host, 'ss-out'), 'LISTEN 0 128 0.0.0.0:2222 users:(("sshd",pid=1,fd=3))\n');
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('2222');
    expect(r.out).toContain('SSH lockout');
    expect(mutating(r.calls)).toEqual([]);
  });

  jqTest('enables the nftables unit at apply', () => {
    expect(run(makeHost(), ['--apply']).calls).toContain('systemctl enable nftables');
  });

  jqTest('calls docker compose version at apply', () => {
    expect(run(makeHost(), ['--apply']).calls).toContain('docker compose version');
  });

  jqTest('a docker compose v2 that does not answer dies at apply', () => {
    const host = makeHost();
    writeFileSync(st(host, 'compose-fail'), '');
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('docker compose v2 does not answer');
  });
});
