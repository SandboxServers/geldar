// G3-01: deploy/genesis/bootstrap.sh converges a clean Debian host. These tests run it with stubs on PATH (apt-get,
// dpkg-query, getent, useradd, groupadd, install, stat, systemctl, nft, sysctl, apt-mark, curl, gpg, git, docker, id)
// and a temp target root. The stubs keep their state in files: a package is a file, an owner and mode are a file
// (what stat reports). Every stub call is logged, so a run's mutating calls can be counted. Nothing touches a real host.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEPLOY, posix, SH } from './colo-deploy-fixture';

const BOOT = join(DEPLOY, 'genesis', 'bootstrap.sh');
const FPR = '9DC858229FC7DD38854AE2D88D81803C0EBFCD88';
const CANARY = 'CANARY-SECRET-7f3a';
// The docker step merges daemon.json with jq, so an apply that reaches it needs jq on the test PATH (Linux CI has it).
// Where it is absent those apply tests are skipped and the skip is visible in the run output.
const HAS_JQ =
  spawnSync(SH, ['-c', 'command -v jq'], { env: { PATH: '/usr/bin:/bin' } }).status === 0;
// Verbs that change a host. A run whose log has none of these issued no mutating call.
const MUTATING =
  /^(apt-get (install|update)|apt-mark hold|systemctl (enable|restart)|useradd|groupadd|install|nft|sysctl|curl)( |$)/;
const DEBIAN_12 = 'ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n';
const DEBIAN_13 = 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n';

// Stub preamble: every call is logged; last_arg returns the final argument.
const PRE = `echo "$(basename "$0") $*" >>"$STUB_LOG"
last_arg() { for a in "$@"; do last=$a; done; printf '%s' "$last"; }
`;
const STUBS: Record<string, string> = {
  'apt-get': `verb=$1; shift
[ "$verb" = install ] || exit 0
skip=
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    -t) skip=1 ;;
    -*) ;;
    *=*) printf '%s' "$(echo "$a" | cut -d= -f2)" >"$STUB_STATE/pkgs/$(echo "$a" | cut -d= -f1)" ;;
    *) printf 'stub' >"$STUB_STATE/pkgs/$a" ;;
  esac
done
`,
  'dpkg-query': `last=$(last_arg "$@")
[ -f "$STUB_STATE/pkgs/$last" ] || exit 1
cat "$STUB_STATE/pkgs/$last"
`,
  getent: `db=$1; name=$2
case "$db" in
  passwd) f="$STUB_STATE/users/$name"; [ -f "$f" ] || exit 2; read -r u g <"$f"; echo "$name:x:$u:$g::/home/$name:/bin/sh" ;;
  group) f="$STUB_STATE/groups/$name"; [ -f "$f" ] || exit 2; echo "$name:x:$(cat "$f"):" ;;
  *) exit 2 ;;
esac
`,
  useradd: `uid=; gid=; name=
while [ $# -gt 0 ]; do
  case "$1" in
    --uid) uid=$2; shift ;;
    --gid) gid=$2; shift ;;
    --shell) shift ;;
    -*) ;;
    *) name=$1 ;;
  esac
  shift
done
echo "$uid $gid" >"$STUB_STATE/users/$name"
`,
  groupadd: `gid=; name=
while [ $# -gt 0 ]; do
  case "$1" in
    --gid) gid=$2; shift ;;
    -*) ;;
    *) name=$1 ;;
  esac
  shift
done
echo "$gid" >"$STUB_STATE/groups/$name"
`,
  install: `dir=0; mode=755; owner=0; group=0; pos=
while [ $# -gt 0 ]; do
  case "$1" in
    -d) dir=1 ;;
    -m) mode=$2; shift ;;
    -o) owner=$2; shift ;;
    -g) group=$2; shift ;;
    *) pos="$pos $1" ;;
  esac
  shift
done
set -- $pos
if [ "$dir" = 1 ]; then dest=$1; mkdir -p "$dest"; else cp "$1" "$2"; dest=$2; fi
key=$(printf '%s' "$dest" | tr / _)
printf '%s %s:%s' "$mode" "$owner" "$group" >"$STUB_STATE/attrs/$key"
`,
  stat: `key=$(printf '%s' "$3" | tr / _)
f="$STUB_STATE/attrs/$key"
[ -f "$f" ] || exit 1
cat "$f"
`,
  systemctl: `verb=$1; unit=$(last_arg "$@")
case "$verb" in
  is-enabled) [ -f "$STUB_STATE/svc/$unit" ] ;;
  enable) touch "$STUB_STATE/svc/$unit" ;;
  *) exit 0 ;;
esac
`,
  'apt-mark': `case "$1" in
  showhold) ls "$STUB_STATE/holds" 2>/dev/null ;;
  hold) shift; for p in "$@"; do touch "$STUB_STATE/holds/$p"; done ;;
esac
exit 0
`,
  curl: `out=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; esac; shift; done
echo 'stub key block' >"$out"
`,
  gpg: 'echo "fpr:::::::::$STUB_FPR:"\n',
  git: 'echo "git version $(cat "$STUB_STATE/git-version")"\n',
  id: 'echo 0\n',
  docker: 'exit 0\n',
  nft: 'exit 0\n',
  sysctl: 'exit 0\n',
};

interface Host {
  root: string; // target root: etc, var, opt
  sandbox: string; // stubs, state and the call log
  env: string;
  osRelease: string;
  log: string;
}
const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'geldar-boot-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// Non-secret settings, as envs/<name>.yaml would produce them. The version pins are fixture values for the stubs.
function settings(root: string): Record<string, string> {
  return {
    GELDAR_ENV_NAME: 'test',
    GELDAR_OPERATOR_USER: 'operator',
    GELDAR_DOCKER_CE_VERSION: '5:28.5.1-1~debian.12~bookworm',
    GELDAR_CONTAINERD_VERSION: '1.7.28-1~debian.12~bookworm',
    GELDAR_DOCKER_BUILDX_VERSION: '0.29.1-1~debian.12~bookworm',
    GELDAR_DOCKER_COMPOSE_VERSION: '2.39.4-1~debian.12~bookworm',
    GELDAR_DOCKER_POOL_BASE: '198.51.100.0/24',
    GELDAR_PUBLIC_TCP_PORTS: '25565',
    GELDAR_STATE_DIR: join(root, 'var/lib/geldar-test'),
    GELDAR_SECRETS_DIR: join(root, 'etc/geldar-test/secrets'),
    GELDAR_TOKENS_DIR: join(root, 'etc/geldar-test/tokens'),
    GELDAR_SRC_DIR: join(root, 'opt/geldar-test/src'),
  };
}

function makeHost(
  opts: { git?: string; osRelease?: string; drop?: string[]; extra?: string[] } = {},
): Host {
  const root = tempDir();
  const sandbox = tempDir();
  const bin = join(sandbox, 'bin');
  mkdirSync(bin);
  for (const d of ['pkgs', 'users', 'groups', 'attrs', 'svc', 'holds'])
    mkdirSync(join(sandbox, 'state', d), { recursive: true });
  writeFileSync(join(sandbox, 'state', 'git-version'), opts.git ?? '2.52.0');
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${PRE}${body}`, { mode: 0o755 });
  }
  // A secret file that already exists: the bootstrap must leave it exactly as it is.
  mkdirSync(join(root, 'etc/geldar-test/secrets'), { recursive: true });
  writeFileSync(join(root, 'etc/geldar-test/secrets/nats.txt'), CANARY);
  const osRelease = join(root, 'os-release');
  writeFileSync(osRelease, opts.osRelease ?? DEBIAN_12);
  const cfg = settings(root);
  for (const k of opts.drop ?? []) delete cfg[k];
  const lines = [...Object.entries(cfg).map(([k, v]) => `${k}=${v}`), ...(opts.extra ?? [])];
  const env = join(sandbox, 'test.env');
  writeFileSync(env, `${lines.join('\n')}\n`);
  return { root, sandbox, env, osRelease, log: join(sandbox, 'calls.log') };
}

interface Run {
  code: number;
  out: string;
  calls: string[];
}
function readCalls(host: Host): string[] {
  return existsSync(host.log) ? readFileSync(host.log, 'utf8').split('\n').filter(Boolean) : [];
}
function run(host: Host, args: string[]): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^path$/i.test(k)) env[k] = v;
  const path = join(host.sandbox, 'bin');
  const res = spawnSync(SH, [posix(BOOT), posix(host.env), ...args], {
    encoding: 'utf8',
    env: {
      ...env,
      // Stubs first, then the POSIX system bins for the real coreutils (sed, cmp, mktemp, jq, ...).
      PATH: `${posix(path)}:/usr/bin:/bin`,
      STUB_LOG: posix(host.log),
      STUB_STATE: posix(join(host.sandbox, 'state')),
      STUB_FPR: FPR,
      BOOTSTRAP_ROOT: posix(host.root),
      BOOTSTRAP_OS_RELEASE: posix(host.osRelease),
    },
  });
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, calls: readCalls(host) };
}
const mutating = (calls: string[]) => calls.filter((c) => MUTATING.test(c));

// Every file under the target root, by path relative to it.
function snapshot(
  dir: string,
  base = dir,
  acc: Record<string, string> = {},
): Record<string, string> {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, acc);
    else acc[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return acc;
}

describe('G3-01 deploy/genesis/bootstrap.sh', () => {
  it('dry-run is the default and calls nothing mutating', () => {
    const host = makeHost();
    const r = run(host, []);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run:');
    expect(mutating(r.calls)).toEqual([]);
    expect(existsSync(join(host.root, 'etc/docker/daemon.json'))).toBe(false);
    expect(readFileSync(join(host.root, 'etc/geldar-test/secrets/nats.txt'), 'utf8')).toBe(CANARY);
  });

  it.skipIf(!HAS_JQ)(
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
      // The secret value is untouched and never printed.
      expect(readFileSync(join(host.root, 'etc/geldar-test/secrets/nats.txt'), 'utf8')).toBe(
        CANARY,
      );
      expect(first.out + second.out).not.toContain(CANARY);
    },
  );

  it.skipIf(!HAS_JQ)('merges the address pools into daemon.json and keeps the other keys', () => {
    const host = makeHost();
    const daemon = join(host.root, 'etc/docker/daemon.json');
    mkdirSync(join(host.root, 'etc/docker'), { recursive: true });
    writeFileSync(
      daemon,
      JSON.stringify({
        'log-driver': 'json-file',
        'default-address-pools': [{ base: '203.0.113.0/24', size: 20 }],
      }),
    );
    expect(run(host, ['--apply']).code).toBe(0);
    const merged = JSON.parse(readFileSync(daemon, 'utf8'));
    expect(merged['log-driver']).toBe('json-file');
    expect(merged['default-address-pools']).toEqual([{ base: '198.51.100.0/24', size: 24 }]);
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

  it.skipIf(!HAS_JQ)(
    'fails the apply when git stays below 2.40, and accepts 2.40.0 at the floor',
    () => {
      const low = makeHost({ git: '2.39.2' });
      const lowRun = run(low, ['--apply']);
      expect(lowRun.code).not.toBe(0);
      expect(lowRun.out).toContain('the floor is 2.40');
      const floor = makeHost({ git: '2.40.0' });
      expect(run(floor, ['--apply']).code).toBe(0);
    },
  );

  it('stops before any call when a required Docker pin is unset, and names the variable', () => {
    const host = makeHost({ drop: ['GELDAR_DOCKER_CE_VERSION'] });
    const r = run(host, []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_DOCKER_CE_VERSION is required');
    expect(r.calls).toEqual([]);
  });

  it('refuses a line that is not a GELDAR_ or BOOTSTRAP_ setting without echoing its value', () => {
    const host = makeHost({ extra: [`STRAY_TOKEN=${CANARY}`] });
    const r = run(host, ['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('is not a GELDAR_ or BOOTSTRAP_ KEY=VALUE setting');
    expect(r.out).not.toContain(CANARY);
    expect(mutating(r.calls)).toEqual([]);
  });
});
