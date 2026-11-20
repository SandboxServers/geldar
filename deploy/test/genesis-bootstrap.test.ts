// G3-01: deploy/genesis/bootstrap.sh converges a clean Debian host. These tests run it with stubs on PATH (see
// genesis-bootstrap-fixture.ts) against a temp target root. Tests marked jqTest need jq and fail in CI without it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { posix } from './colo-deploy-fixture';
import {
  CANARY,
  DEBIAN_13,
  FPR,
  type Host,
  indexOfCall,
  jqTest,
  makeHost,
  mutating,
  run,
  snapshot,
  st,
  WRONG_FPR,
} from './genesis-bootstrap-fixture';

const nftFile = (h: Host) => join(h.root, 'etc/nftables.d/geldar-test.nft');
const daemonFile = (h: Host) => join(h.root, 'etc/docker/daemon.json');
const confFile = (h: Host) => join(h.root, 'etc/nftables.conf');
const secretText = (h: Host) =>
  readFileSync(join(h.root, 'etc/geldar-test/secrets/nats.txt'), 'utf8');

describe('G3-01 deploy/genesis/bootstrap.sh', () => {
  it('dry-run is the default: nothing mutating, root unchanged, effective ports printed', () => {
    const host = makeHost();
    const before = snapshot(host.root);
    const r = run(host, []);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run:');
    expect(r.out).toContain('effective TCP ports: 22,25565');
    expect(mutating(r.calls)).toEqual([]);
    expect(snapshot(host.root)).toEqual(before);
    expect(secretText(host)).toBe(CANARY);
  });

  jqTest(
    'apply twice: the second run issues no mutating call and the end state does not change',
    () => {
      const host = makeHost();
      const first = run(host, ['--apply']);
      expect(first.code).toBe(0);
      expect(mutating(first.calls).length).toBeGreaterThan(0);
      const before = snapshot(host.root);
      const second = run(host, ['--apply']);
      expect(second.code).toBe(0);
      expect(mutating(second.calls)).toEqual([]);
      expect(snapshot(host.root)).toEqual(before);
      expect(secretText(host)).toBe(CANARY);
      expect(first.out + second.out).not.toContain(CANARY);
    },
  );

  jqTest('merges the address pools into daemon.json and keeps the other keys', () => {
    const host = makeHost();
    mkdirSync(join(host.root, 'etc/docker'), { recursive: true });
    writeFileSync(
      daemonFile(host),
      JSON.stringify({
        'log-driver': 'json-file',
        'default-address-pools': [{ base: '203.0.113.0/24', size: 20 }],
      }),
    );
    expect(run(host, ['--apply']).code).toBe(0);
    const merged = JSON.parse(readFileSync(daemonFile(host), 'utf8'));
    expect(merged['log-driver']).toBe('json-file');
    expect(merged['default-address-pools']).toEqual([{ base: '198.51.100.0/24', size: 24 }]);
  });

  jqTest('an empty or blank daemon.json counts as {} and gets the pools', () => {
    for (const content of ['', '  \n\n']) {
      const host = makeHost();
      mkdirSync(join(host.root, 'etc/docker'), { recursive: true });
      writeFileSync(daemonFile(host), content);
      expect(run(host, ['--apply']).code).toBe(0);
      const merged = JSON.parse(readFileSync(daemonFile(host), 'utf8'));
      expect(merged).toEqual({ 'default-address-pools': [{ base: '198.51.100.0/24', size: 24 }] });
    }
  });

  jqTest('refuses a daemon.json that is not a JSON object and leaves it as it is', () => {
    for (const content of ['[1,2]', '{"log-driver":']) {
      const host = makeHost();
      mkdirSync(join(host.root, 'etc/docker'), { recursive: true });
      writeFileSync(daemonFile(host), content);
      const r = run(host, ['--apply']);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('must hold a JSON object');
      expect(readFileSync(daemonFile(host), 'utf8')).toBe(content);
    }
  });

  it.each([
    ['Ubuntu 24.04', 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n'],
    ['Debian 11', 'ID=debian\nVERSION_ID="11"\nVERSION_CODENAME=bullseye\n'],
  ])('refuses a non-Debian-12-or-13 host (%s) and changes nothing', (_name, osRelease) => {
    const host = makeHost({ osRelease });
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('needs Debian 12 or 13');
    expect(mutating(r.calls)).toEqual([]);
  });

  it('accepts Debian 13 as a host for a dry run', () => {
    const r = run(makeHost({ osRelease: DEBIAN_13 }), []);
    expect(r.code).toBe(0);
    expect(r.out).toContain('debian=13');
  });

  it('fails the apply when git stays below 2.40 (no jq needed: the run stops before docker)', () => {
    const r = run(makeHost({ git: '2.39.2' }), ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('the floor is 2.40');
  });

  jqTest('accepts git 2.40.0 at the floor', () => {
    expect(run(makeHost({ git: '2.40.0' }), ['--apply']).code).toBe(0);
  });

  it('stops before any call when a required Docker pin is unset, and names the variable', () => {
    const r = run(makeHost({ drop: ['GELDAR_DOCKER_CE_VERSION'] }), []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_DOCKER_CE_VERSION is required');
    expect(r.calls).toEqual([]);
  });

  it('stops before any call when the Docker key fingerprint is unset, and names only the variable', () => {
    const r = run(makeHost({ drop: ['GELDAR_DOCKER_KEY_FPR'] }), ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_DOCKER_KEY_FPR is required');
    expect(r.calls).toEqual([]);
  });

  it('refuses a malformed fingerprint before any call', () => {
    const r = run(
      makeHost({
        drop: ['GELDAR_DOCKER_KEY_FPR'],
        extra: ['GELDAR_DOCKER_KEY_FPR=not-a-fingerprint'],
      }),
      [],
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_DOCKER_KEY_FPR must be the 40 hex digits');
    expect(r.calls).toEqual([]);
  });

  jqTest('normalises a fingerprint written in lower case with spaces', () => {
    const spaced =
      FPR.toLowerCase()
        .match(/.{1,4}/g)
        ?.join(' ') ?? '';
    const host = makeHost({
      drop: ['GELDAR_DOCKER_KEY_FPR'],
      extra: [`GELDAR_DOCKER_KEY_FPR=${spaced}`],
    });
    expect(run(host, ['--apply']).code).toBe(0);
  });

  it('a wrong fingerprint dies and installs no docker.asc', () => {
    const host = makeHost();
    const r = run(host, ['--apply'], { STUB_FPR: WRONG_FPR });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('does not match the pinned fingerprint');
    expect(existsSync(join(host.root, 'etc/apt/keyrings/docker.asc'))).toBe(false);
  });

  it('a keyring with an extra primary key dies and installs no docker.asc', () => {
    const host = makeHost();
    writeFileSync(st(host, 'gpg-extra'), `${WRONG_FPR}\n`);
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(existsSync(join(host.root, 'etc/apt/keyrings/docker.asc'))).toBe(false);
  });

  it('fetches the Docker key over https only, with a timeout and --fail', () => {
    const r = run(makeHost(), ['--apply']);
    const curl = r.calls.find((c) => c.startsWith('curl '));
    expect(curl).toMatch(/--fail .*--proto =https --tlsv1\.2 --max-time 60/);
  });

  it.each([
    ['GELDAR_PUBLIC_TCP_PORTS', '0'],
    ['GELDAR_PUBLIC_TCP_PORTS', '65536'],
    ['GELDAR_PUBLIC_TCP_PORTS', '123456'],
    ['GELDAR_PUBLIC_TCP_PORTS', '99999999999999999999'],
    ['BOOTSTRAP_SSH_PORT', '0'],
    ['BOOTSTRAP_SSH_PORT', '65536'],
  ])('refuses %s=%s before any call', (key, value) => {
    const r = run(makeHost({ drop: [key], extra: [`${key}=${value}`] }), ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('TCP port');
    expect(r.calls).toEqual([]);
  });

  it('accepts the port range edges 1 and 65535', () => {
    const host = makeHost({
      drop: ['GELDAR_PUBLIC_TCP_PORTS'],
      extra: ['GELDAR_PUBLIC_TCP_PORTS=1,65535'],
    });
    expect(run(host, []).out).toContain('effective TCP ports: 1,22,65535');
  });

  it.each([
    ['GELDAR_STATE_DIR', '/etc'],
    ['GELDAR_SECRETS_DIR', 'relative/secrets'],
    ['GELDAR_TOKENS_DIR', '/etc/geldar-test/tokens/'],
    ['GELDAR_SRC_DIR', '/opt/geldar-test/../src'],
  ])('refuses the directory setting %s=%s before any call', (key, value) => {
    const r = run(makeHost({ drop: [key], extra: [`${key}=${value}`] }), ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.calls).toEqual([]);
  });

  it.each([['--dry-run'], ['--apply']])('refuses a taken uid before any change (%s)', (mode) => {
    const host = makeHost();
    writeFileSync(st(host, 'users', 'debian'), '1000 1000\n');
    writeFileSync(st(host, 'groups', 'debian'), '1000\n');
    const r = run(host, [mode]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('belongs to debian');
    expect(mutating(r.calls)).toEqual([]);
  });

  it('dies before any rule when sshd listens on a port the settings do not allow', () => {
    const host = makeHost();
    writeFileSync(st(host, 'sshd-config'), 'port 2222\n');
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('SSH lockout');
    expect(mutating(r.calls)).toEqual([]);
    expect(existsSync(nftFile(host))).toBe(false);
  });

  it('dies when the server port of this SSH session is not allowed', () => {
    const r = run(makeHost(), ['--apply'], { SSH_CONNECTION: 'x 50000 y 2233' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('2233');
    expect(mutating(r.calls)).toEqual([]);
  });

  jqTest('loads a sshd port that BOOTSTRAP_SSH_PORT names, and the generated file lists it', () => {
    const host = makeHost({ extra: ['BOOTSTRAP_SSH_PORT=2222'] });
    writeFileSync(st(host, 'sshd-config'), 'port 2222\n');
    expect(run(host, ['--apply']).code).toBe(0);
    expect(readFileSync(nftFile(host), 'utf8')).toContain('tcp dport { 2222, 25565 } accept');
  });

  jqTest(
    'the generated nft file has policy drop, loopback, SSH and the public ports from the setting',
    () => {
      const host = makeHost();
      expect(run(host, ['--apply']).code).toBe(0);
      const nft = readFileSync(nftFile(host), 'utf8');
      expect(nft).toContain('add table inet geldar_test');
      expect(nft).toContain('policy drop;');
      expect(nft).toContain('iif "lo" accept');
      expect(nft).toContain('tcp dport { 22, 25565 } accept');
    },
  );

  jqTest(
    'a file that does not parse adds no include; a rerun after a failed load completes it',
    () => {
      const host = makeHost();
      writeFileSync(st(host, 'nft-fail'), '');
      const first = run(host, ['--apply']);
      expect(first.code).not.toBe(0);
      expect(existsSync(confFile(host)) ? readFileSync(confFile(host), 'utf8') : '').not.toContain(
        posix(nftFile(host)),
      );
      expect(first.calls.some((c) => c.startsWith('nft -f'))).toBe(false);
      rmSync(st(host, 'nft-fail'));
      const second = run(host, ['--apply']);
      expect(second.code).toBe(0);
      expect(second.calls).toContain(`nft -f ${posix(nftFile(host))}`);
      expect(readFileSync(confFile(host), 'utf8')).toContain(posix(nftFile(host)));
    },
  );

  jqTest('the include line goes on its own line after a file with no trailing newline', () => {
    const host = makeHost();
    mkdirSync(join(host.root, 'etc'), { recursive: true });
    writeFileSync(confFile(host), 'include "/etc/other.nft"');
    expect(run(host, ['--apply']).code).toBe(0);
    expect(readFileSync(confFile(host), 'utf8').split('\n')).toContain(
      `include "${posix(nftFile(host))}"`,
    );
  });

  jqTest('sysctl is reloaded when the live value drifts, though the file is unchanged', () => {
    const host = makeHost();
    expect(run(host, ['--apply']).code).toBe(0);
    writeFileSync(st(host, 'sysctl', 'vm.max_map_count'), '65530');
    const again = run(host, ['--apply']);
    expect(again.code).toBe(0);
    expect(again.calls.some((c) => c.startsWith('sysctl -q -p'))).toBe(true);
    expect(readFileSync(st(host, 'sysctl', 'vm.max_map_count'), 'utf8')).toBe('262144');
  });

  jqTest('a rerun after a failed docker restart restarts the daemon again', () => {
    const host = makeHost();
    writeFileSync(st(host, 'restart-fail'), '');
    expect(run(host, ['--apply']).code).not.toBe(0);
    expect(existsSync(join(host.root, 'etc/docker/geldar-pools.sha256'))).toBe(false);
    rmSync(st(host, 'restart-fail'));
    const second = run(host, ['--apply']);
    expect(second.code).toBe(0);
    expect(second.calls).toContain('systemctl restart docker');
  });

  jqTest('a changed pin unholds the Docker packages, installs, then holds them again', () => {
    const host = makeHost();
    expect(run(host, ['--apply']).code).toBe(0);
    const next = '5:28.6.0-1~debian.12~bookworm';
    writeFileSync(
      host.env,
      readFileSync(host.env, 'utf8').replace('5:28.5.1-1~debian.12~bookworm', next),
    );
    const r = run(host, ['--apply']);
    expect(r.code).toBe(0);
    const un = indexOfCall(r.calls, /^apt-mark unhold docker-ce$/);
    const ins = indexOfCall(r.calls, /^apt-get install .*docker-ce=5:28\.6\.0/);
    const hold = indexOfCall(r.calls, /^apt-mark hold /);
    expect(un).toBeGreaterThanOrEqual(0);
    expect(ins).toBeGreaterThan(un);
    expect(hold).toBeGreaterThan(ins);
  });

  it('creates the docker group before the packages step, so the Docker postinst reuses its gid', () => {
    const r = run(makeHost(), ['--apply']);
    const group = indexOfCall(r.calls, /^groupadd --gid 999 docker$/);
    const pkgs = indexOfCall(r.calls, /^apt-get install/);
    expect(group).toBeGreaterThanOrEqual(0);
    expect(pkgs).toBeGreaterThan(group);
  });

  jqTest('installs systemd-timesyncd and enables it when no other time-sync service runs', () => {
    const r = run(makeHost(), ['--apply']);
    expect(r.calls).toContain('apt-get install -y --no-install-recommends systemd-timesyncd');
    expect(r.calls).toContain('systemctl enable --now systemd-timesyncd');
  });

  jqTest('leaves systemd-timesyncd alone when chrony is active', () => {
    const host = makeHost();
    mkdirSync(st(host, 'active'), { recursive: true });
    writeFileSync(st(host, 'active', 'chrony'), '');
    const r = run(host, ['--apply']);
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.includes('timesyncd'))).toEqual([]);
  });

  jqTest(
    'dies with a named message when no time-sync service is available, and enables nothing',
    () => {
      const host = makeHost();
      rmSync(st(host, 'units', 'systemd-timesyncd'));
      const r = run(host, ['--apply']);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('no time-sync service');
      expect(r.calls).not.toContain('systemctl enable --now systemd-timesyncd');
    },
  );

  jqTest('the logrotate stanza names the service user and group', () => {
    const host = makeHost();
    expect(run(host, ['--apply']).code).toBe(0);
    expect(readFileSync(join(host.root, 'etc/logrotate.d/geldar-test'), 'utf8')).toContain(
      '  su geldar geldar\n',
    );
  });
});
