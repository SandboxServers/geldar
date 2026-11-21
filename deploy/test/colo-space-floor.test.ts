// Tests for deploy/space-floor.sh as used by the deploy scripts: colo-cd.sh checks before its first write; the deploy volume and
// Docker's data root have their own, lower block floor (GELDAR_MIN_FREE_KB_DEPLOY, default 1 GiB: /var is a small volume);
// colo-rollback.sh does not refuse on volumes it does not write to.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdRun, cdSetup } from './colo-cd-fixture';
import {
  calls,
  fixture,
  PREV_BODY,
  posix,
  REAL,
  REAL_BIN,
  release,
  run,
} from './colo-deploy-fixture';

// df: for a path containing "poor", POOR_KB free blocks and POOR_INODES free inodes; plenty elsewhere.
const DF = `#!/bin/sh
for a; do p=$a; done
case "$p" in *poor*) poor=1;; *) poor=0;; esac
if [ "$1" = -Pi ]; then n=900000; [ $poor = 1 ] && n=\${POOR_INODES:-900000}
  printf 'F I U IF P M\\nx 1000000 1 %s 1%% /\\n' "$n"
else n=999999999; [ $poor = 1 ] && n=\${POOR_KB:-999999999}
  printf 'F B U A C M\\nx 999999999 1 %s 1%% /\\n' "$n"; fi
exit 0
`;

function shims(dir: string, log: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'df'), DF, { mode: 0o755 });
  writeFileSync(
    join(bin, 'mktemp'),
    `#!/bin/sh\necho "$*" >> "${posix(log)}"\nexec "${REAL_BIN}/mktemp" "$@"\n`,
    { mode: 0o755 },
  );
}

describe('colo-cd.sh checks the floors before its first write', () => {
  it('refuses a deploy volume out of inodes without calling mktemp, and reaches mktemp when healthy', () => {
    const cd = cdSetup({}, []);
    const poor = join(cd.fx.dir, 'poor');
    mkdirSync(poor);
    const log = join(cd.fx.dir, 'mktemp.log');
    shims(cd.fx.dir, log);
    const env = { GELDAR_MIN_FREE_INODES: '100', POOR_INODES: '50' };
    const r = cdRun(cd, { env: { ...env, GELDAR_DEPLOY_VOLUME: posix(poor) } });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('free inodes 50 of the deploy volume');
    expect(existsSync(log)).toBe(false);
    cdRun(cd, { env: { ...env, GELDAR_DEPLOY_VOLUME: posix(cd.fx.dir) } });
    expect(existsSync(log)).toBe(true);
  });
});

describe('the deploy volume has its own block floor', () => {
  const GIB = 1048576;
  const go = (kb: number, extra: Record<string, string> = {}) => {
    const fx = fixture();
    const poor = join(fx.dir, 'poor');
    mkdirSync(poor);
    shims(fx.dir, join(fx.dir, 'mktemp.log'));
    return run('colo-up.sh', fx, {
      ...REAL,
      GELDAR_MIN_FREE_KB: '10485760',
      GELDAR_DEPLOY_VOLUME: posix(poor),
      POOR_KB: String(kb),
      ...extra,
    }).out;
  };

  it('2 GiB free on the deploy volume is not refused by the 10 GiB checkout floor', () => {
    // The checkout floor is 10 GiB, and the (non-"poor") checkout reports far more; the deploy volume has 2 GiB.
    expect(go(2 * GIB)).not.toContain('of the deploy volume');
  });

  it('refuses below the deploy floor, printing measured and required', () => {
    expect(go(GIB / 2)).toContain('free disk 524288 KiB (blocks) of the deploy volume');
    expect(go(GIB / 2)).toContain('threshold of 1048576 KiB');
  });

  it('GELDAR_MIN_FREE_KB_DEPLOY overrides it', () => {
    expect(go(2 * GIB, { GELDAR_MIN_FREE_KB_DEPLOY: String(4 * GIB) })).toContain(
      'threshold of 4194304 KiB',
    );
  });
});

describe('scripts that do not write to /var or Docker do not refuse on them', () => {
  it('colo-rollback.sh ignores a deploy volume out of inodes and blocks', () => {
    const fx = fixture();
    const poor = join(fx.dir, 'poor');
    mkdirSync(poor);
    mkdirSync(fx.state, { recursive: true });
    writeFileSync(join(fx.state, 'previous.env'), release(PREV_BODY), { mode: 0o600 });
    shims(fx.dir, join(fx.dir, 'mktemp.log'));
    const r = run('colo-rollback.sh', fx, {
      ...REAL,
      GELDAR_DEPLOY_VOLUME: posix(poor),
      GELDAR_MIN_FREE_INODES: '100',
      POOR_INODES: '5',
      POOR_KB: '5',
    });
    expect(r.out).not.toContain('deploy volume');
    expect(r.out).not.toContain('free inodes');
    // It got past the prerequisites (where the floors run) to the merged-config check.
    expect(r.out).toContain('compose config: valid');
  });
});

describe('the Docker-root lookup', () => {
  // colo-deploy.test.ts and colo-admin.test.ts allow only these docker calls that name no project; the lookup must match.
  const ALLOWED = /^(compose version|info( --format \{\{\.DockerRootDir\}\})?)$/;

  it('is a read-only `docker info` call that the unscoped-call allow-list accepts', () => {
    const fx = fixture();
    run('colo-up.sh', fx, REAL);
    const info = calls(fx).filter((c) => c.startsWith('info'));
    expect(info).toContain('info --format {{.DockerRootDir}}');
    for (const c of info) expect(c).toMatch(ALLOWED);
  });
});

describe("Docker's data root has the same block floor as the deploy volume", () => {
  const GIB = 1048576;
  // The fixture's docker answers `info` with nothing; this wrapper names a directory as Docker's data root.
  const go = (kb: number) => {
    const fx = fixture();
    const poor = join(fx.dir, 'poor');
    mkdirSync(poor);
    shims(fx.dir, join(fx.dir, 'mktemp.log'));
    const bin = join(fx.dir, 'bin');
    writeFileSync(join(bin, 'docker.orig'), readFileSync(join(bin, 'docker'), 'utf8'), {
      mode: 0o755,
    });
    writeFileSync(
      join(bin, 'docker'),
      '#!/bin/sh\ncase "$*" in *"info --format"*) echo "$FAKE_DOCKER_ROOT"; exit 0;; esac\nexec "$(dirname "$0")/docker.orig" "$@"\n',
      { mode: 0o755 },
    );
    return run('colo-up.sh', fx, {
      ...REAL,
      GELDAR_MIN_FREE_KB: '10485760',
      GELDAR_DEPLOY_VOLUME: posix(fx.dir),
      FAKE_DOCKER_ROOT: posix(poor),
      POOR_KB: String(kb),
    }).out;
  };

  it('refuses below the deploy floor (the checkout is fine), printing measured and required', () => {
    const out = go(GIB / 2);
    expect(out).toContain('free disk 524288 KiB (blocks) of the docker data root');
    expect(out).toContain('threshold of 1048576 KiB');
  });

  it('passes at 2 GiB, which the 10 GiB checkout floor would refuse', () => {
    expect(go(2 * GIB)).not.toContain('of the docker data root');
  });
});

describe('the shim helper', () => {
  // A mktemp shim that hands over to the real tool must find it: on Linux SH is the bare word `sh`, and dirname('sh') is '.',
  // which made the first version of these shims fail to run mktemp there (CI: PR 863).
  it('REAL_BIN is a directory that holds the real mktemp and ls', () => {
    for (const tool of ['mktemp', 'ls']) {
      const found = existsSync(join(REAL_BIN, tool)) || existsSync(join(REAL_BIN, `${tool}.exe`));
      expect(found, `${tool} in ${REAL_BIN}`).toBe(true);
    }
  });
});
