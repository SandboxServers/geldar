import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BODY,
  CONFIG,
  calls,
  DEPLOY,
  fixture,
  GENERATED,
  lockText,
  mutates,
  PREV_BODY,
  PROJECT_FILTER,
  posix,
  REAL,
  REAL_BIN,
  release,
  run,
  SECRET_FILES,
  STATS_BY_ID,
  secretValue,
  setMode,
  sha256,
} from './colo-deploy-fixture';

describe('colo-up.sh (decision 0084)', () => {
  it('dry run prints the plan and runs only read-only compose calls', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('project: geldar-colo');
    const log = calls(fx);
    expect(log.some((c) => c.includes('config --quiet'))).toBe(true);
    expect(mutates(log)).toBe(false);
  });

  it('deploys by pull: config checks, then pull, then up --wait, with the record written first', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    const at = (needle: string) => log.findIndex((c) => c.includes(needle));
    expect(at('config --quiet')).toBeGreaterThanOrEqual(0);
    expect(at('config --quiet')).toBeLessThan(at(' pull'));
    expect(at(' pull')).toBeLessThan(at('up -d --wait'));
    expect(existsSync(join(fx.state, 'current.env'))).toBe(true);
    expect(readFileSync(join(fx.state, 'bluemap', 'bluemap.jar'), 'utf8')).toBe(fx.jarText);
    for (const f of SECRET_FILES) expect(r.out).not.toContain(secretValue(f));
  });

  it('refuses when a secret file is missing, and runs no pull or up', () => {
    const fx = fixture();
    rmSync(join(fx.secrets, 'rcon.txt'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('rcon.txt');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each(['600', '400'])('accepts a secret file at mode %s', (mode) => {
    const fx = fixture();
    for (const f of SECRET_FILES) setMode(fx, f, mode);
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('has mode');
  });

  it('refuses a secret file that other accounts can read (mode 644), and runs no pull or up', () => {
    const fx = fixture();
    setMode(fx, 'postgres.txt', '644');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres.txt has mode 644');
    expect(r.out).not.toContain(secretValue('postgres.txt'));
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each([
    [
      'a latest tag',
      release(`registry.example.invalid/geldar/body:latest@sha256:${'1'.repeat(64)}`),
    ],
    ['a bare tag with no digest', release('registry.example.invalid/geldar/body:0.1.0')],
  ])('refuses a release manifest that uses %s', (_name, text) => {
    const fx = fixture();
    writeFileSync(fx.release, text);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/latest|digest/);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses a BlueMap jar whose sha256 does not match the lock', () => {
    const fx = fixture();
    writeFileSync(
      fx.lock,
      lockText(pathToFileURL(join(fx.dir, 'bluemap.jar')).href, '0'.repeat(64)),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('sha256 mismatch');
    expect(existsSync(join(fx.state, 'bluemap', 'bluemap.jar'))).toBe(false);
    expect(mutates(calls(fx))).toBe(false);
  });

  it('accepts a BlueMap jar whose sha256 matches the lock', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).toBe(0);
    expect(r.out).toContain('jar verified');
  });

  it.each([
    ['a file:// url without the test-only variable', () => pathToFileURL('bluemap.jar').href, '0'],
    ['an http url', () => 'http://example.invalid/bluemap.jar', '1'],
  ])('refuses a BlueMap lock with %s before any download', (_name, url, allow) => {
    const fx = fixture();
    writeFileSync(fx.lock, lockText(url(), sha256(fx.jarText)));
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_DEPLOY_ALLOW_FILE_URL: allow });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('must be https');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses when the merged config publishes 25565 or 25566', () => {
    for (const port of ['25565', '25566']) {
      const fx = fixture(port);
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('publishes 25565 or 25566');
      expect(mutates(calls(fx))).toBe(false);
    }
  });

  it('refuses a service that would be built on the node with no pinned image', () => {
    const fx = fixture();
    writeFileSync(
      join(fx.dir, 'config.yml'),
      `${CONFIG('25567')}  eventsink:\n    build:\n      context: ..\n`,
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('built on the node without a pinned image: eventsink:');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses when free disk is below the threshold', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_MIN_FREE_KB: '999999999999' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('free disk');
  });

  it('refuses when free inodes are below the threshold, though blocks are plentiful', () => {
    const fx = fixture();
    // A df stand-in: plenty of blocks, 50 free inodes of 1000.
    writeFileSync(
      join(fx.dir, 'bin', 'df'),
      '#!/bin/sh\nif [ "$1" = -Pi ]; then printf "Filesystem Inodes IUsed IFree IUse%% Mounted\\nx 1000 950 50 95%% /\\n"; else printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nx 999999999 1 999999999 1%% /\\n"; fi\n',
      { mode: 0o755 },
    );
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_MIN_FREE_INODES: '100' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('free inodes 50 of the repo checkout');
    expect(mutates(calls(fx))).toBe(false);
  });

  // df stand-in that is poor only for a path containing "poor" (50 free inodes, or 5 free blocks); plenty everywhere else.
  const POOR_DF = (kind: 'inodes' | 'blocks') =>
    `#!/bin/sh\nfor a; do p=$a; done\ncase "$p" in *poor*) poor=1;; *) poor=0;; esac\nif [ "$1" = -Pi ]; then n=900000; if [ $poor = 1 ] && [ ${kind === 'inodes' ? 1 : 0} = 1 ]; then n=50; fi; printf "F I U IF P M\nx 1000000 1 $n 1%% /\n"; else n=999999999; if [ $poor = 1 ] && [ ${kind === 'blocks' ? 1 : 0} = 1 ]; then n=5; fi; printf "F B U A C M\nx 999999999 1 $n 1%% /\n"; fi\n`;

  it.each([
    ['inodes', 'deploy volume', 'free inodes 50 of the deploy volume'],
    ['blocks', 'deploy volume', 'blocks) of the deploy volume'],
    ['inodes', 'docker data root', 'free inodes 50 of the docker data root'],
  ] as const)('refuses on %s of the %s, not only of the repo checkout', (kind, which, msg) => {
    const fx = fixture();
    const poor = join(fx.dir, 'poor');
    mkdirSync(poor);
    writeFileSync(join(fx.dir, 'bin', 'df'), POOR_DF(kind), { mode: 0o755 });
    const orig = readFileSync(join(fx.dir, 'bin', 'docker'), 'utf8');
    writeFileSync(join(fx.dir, 'bin', 'docker.orig'), orig, { mode: 0o755 });
    writeFileSync(
      join(fx.dir, 'bin', 'docker'),
      '#!/bin/sh\ncase "$*" in *"info --format"*) echo "$FAKE_DOCKER_ROOT"; exit 0;; esac\nexec "$(dirname "$0")/docker.orig" "$@"\n',
      { mode: 0o755 },
    );
    const env =
      which === 'deploy volume'
        ? { GELDAR_DEPLOY_VOLUME: posix(poor), FAKE_DOCKER_ROOT: posix(fx.dir) }
        : { GELDAR_DEPLOY_VOLUME: posix(fx.dir), FAKE_DOCKER_ROOT: posix(poor) };
    const r = run('colo-up.sh', fx, {
      ...REAL,
      GELDAR_MIN_FREE_INODES: '100',
      GELDAR_MIN_FREE_KB: '10',
      ...env,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(msg);
  });

  it('a missing deploy volume is skipped with a message; a silent docker info refuses (fail closed, #866)', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, {
      ...REAL,
      GELDAR_DEPLOY_VOLUME: posix(join(fx.dir, 'nope')),
      GELDAR_DOCKER_DAEMON_JSON: posix(join(fx.dir, 'no-daemon.json')),
      NO_DOCKER_ROOT: '1',
    });
    expect(r.out).toContain('space check skipped for the deploy volume');
    expect(r.out).toContain("cannot determine Docker's data root");
  });

  it('the floor fires before the first write: nothing calls mktemp when the deploy volume is out of inodes', () => {
    const fx = fixture();
    const poor = join(fx.dir, 'poor');
    mkdirSync(poor);
    writeFileSync(join(fx.dir, 'bin', 'df'), POOR_DF('inodes'), { mode: 0o755 });
    const log = join(fx.dir, 'mktemp.log');
    writeFileSync(
      join(fx.dir, 'bin', 'mktemp'),
      `#!/bin/sh\necho "$*" >> "${posix(log)}"\nexec "${REAL_BIN}/mktemp" "$@"\n`,
      { mode: 0o755 },
    );
    const env = { GELDAR_MIN_FREE_INODES: '100', GELDAR_DEPLOY_VOLUME: posix(poor) };
    const r = run('colo-up.sh', fx, { ...REAL, ...env });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('free inodes 50 of the deploy volume');
    expect(existsSync(log)).toBe(false);
    // Control: with a healthy volume the same shim is reached, so the check above is not vacuous.
    const ok = run('colo-up.sh', fx, { ...REAL, ...env, GELDAR_DEPLOY_VOLUME: posix(fx.dir) });
    expect(ok.out).not.toContain('free inodes 50');
    expect(existsSync(log)).toBe(true);
  });

  it('a filesystem that reports no inode count (total 0) is not refused on inodes', () => {
    const fx = fixture();
    writeFileSync(
      join(fx.dir, 'bin', 'df'),
      '#!/bin/sh\nif [ "$1" = -Pi ]; then printf "F I U IF P M\nx 0 0 0 - /\n"; else printf "F B U A C M\nx 999999999 1 999999999 1%% /\n"; fi\n',
      { mode: 0o755 },
    );
    const r = run('colo-up.sh', fx, { ...REAL, GELDAR_MIN_FREE_INODES: '100' });
    expect(r.out).not.toContain('free inodes');
  });
});

describe('colo-rollback, colo-down, colo-status (decision 0084)', () => {
  it('rollback re-applies the previous release with --pull never and pulls nothing', () => {
    const fx = fixture();
    mkdirSync(fx.state);
    writeFileSync(join(fx.state, 'previous.env'), release(PREV_BODY), { mode: 0o600 });
    writeFileSync(join(fx.state, 'current.env'), release(BODY), { mode: 0o600 });
    const r = run('colo-rollback.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => c.endsWith('up -d --wait --pull never'))).toBe(true);
    expect(log.some((c) => / pull$| pull /.test(c))).toBe(false);
    expect(readFileSync(fx.release, 'utf8')).toContain(PREV_BODY);
    expect(readFileSync(join(fx.state, 'previous.env'), 'utf8')).toContain(BODY);
  });

  it('rollback refuses when no previous release is recorded', () => {
    const fx = fixture();
    const r = run('colo-rollback.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no previous release');
  });

  it('down stops the project and never removes a container, network or volume', () => {
    const fx = fixture();
    const r = run('colo-down.sh', fx, REAL);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => c.endsWith(' stop'))).toBe(true);
    expect(log.some((c) => / (down|rm|volume|network) /.test(c))).toBe(false);
  });

  it('status is read-only and reads only project containers', () => {
    const fx = fixture();
    const r = run('colo-status.sh', fx);
    expect(r.code).toBe(0);
    const log = calls(fx);
    expect(log.some((c) => / (up|pull|stop|down|rm|restart)( |$)/.test(c))).toBe(false);
    expect(log.filter((c) => c.includes('ps ')).every((c) => PROJECT_FILTER.test(c))).toBe(true);
    expect(log).toContain('stats --no-stream c0ffee01');
  });
});

describe('colo-status inode warning', () => {
  // A df stand-in first on PATH: the `df -Pi` table with the given IUse% for the deploy volume.
  const withDf = (pct: number) => {
    const fx = fixture();
    const table = `Filesystem Inodes IUsed IFree IUse% Mounted
fake 1000 ${pct * 10} ${1000 - pct * 10} ${pct}% /`;
    writeFileSync(
      join(fx.dir, 'bin', 'df'),
      `#!/bin/sh
cat <<'EOT'
${table}
EOT
`,
      { mode: 0o755 },
    );
    return { ...fx, env: { ...fx.env, GELDAR_INODE_PATH: posix(fx.dir) } };
  };

  it('warns when the inodes of the deploy volume are 80% used or more, and still exits 0', () => {
    const r = run('colo-status.sh', withDf(95));
    expect(r.code).toBe(0);
    expect(r.out).toContain('inodes of the deploy volume are 95% used');
    expect(r.out).toContain('prune-deploy-work.sh');
  });

  it('prints nothing about inodes below the threshold', () => {
    const r = run('colo-status.sh', withDf(12));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('inodes');
  });
});

describe('deploy scripts: docker scope and volumes (decision 0084)', () => {
  it('every docker call names the geldar-colo project or its label, and no script runs down -v', () => {
    const fx = fixture();
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
    expect(run('colo-status.sh', fx).code).toBe(0);
    expect(run('colo-down.sh', fx, REAL).code).toBe(0);
    const log = calls(fx);
    expect(log.length).toBeGreaterThan(0);
    for (const c of log) {
      const allowed =
        PROJECT_FILTER.test(c) ||
        STATS_BY_ID.test(c) ||
        /^(compose version|info( --format \{\{\.DockerRootDir\}\})?)$/.test(c);
      expect(allowed, `unscoped docker call: ${c}`).toBe(true);
      expect(c).not.toMatch(/\bdown\b.*(-v\b|--volumes)|--volumes/);
    }
    for (const script of [
      'common.sh',
      'colo-up.sh',
      'colo-rollback.sh',
      'colo-down.sh',
      'colo-status.sh',
    ]) {
      const text = readFileSync(join(DEPLOY, script), 'utf8');
      expect(text, script).not.toMatch(/down -v|--volumes|volume rm|system prune/);
    }
  });
});

describe('gen-secrets.sh (decision 0084)', () => {
  it('creates missing files owner-only, never overwrites, and never prints a value', () => {
    const fx = fixture();
    const target = join(fx.dir, 'fresh-secrets');
    const env = { ...fx.env, GELDAR_SECRETS_DIR: posix(target) };
    const first = run('gen-secrets.sh', { ...fx, env }, {});
    expect(first.code).toBe(0);
    for (const f of GENERATED) {
      const value = readFileSync(join(target, f), 'utf8').trim();
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(first.out).not.toContain(value);
      // NTFS reports 0666 whatever the script does, so the mode is checked on POSIX only (`umask 077` everywhere).
      if (process.platform !== 'win32') expect(statSync(join(target, f)).mode & 0o077).toBe(0);
    }
    expect(readFileSync(join(DEPLOY, 'gen-secrets.sh'), 'utf8')).toContain('umask 077');
    const before = readFileSync(join(target, 'rcon.txt'), 'utf8');
    const second = run('gen-secrets.sh', { ...fx, env }, {});
    expect(second.code).toBe(0);
    expect(second.out).toContain('kept (exists): rcon.txt');
    expect(readFileSync(join(target, 'rcon.txt'), 'utf8')).toBe(before);
    // The NATS files are never generated on the node (decision 0084).
    expect(existsSync(join(target, 'nats-mind.txt'))).toBe(false);
  });
});
