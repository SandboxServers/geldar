// Shared harness for the G3-01 bootstrap tests. Stub commands go first on PATH; they keep their state in files under a
// sandbox (a package is a file, an owner and mode are a file, a loaded nft table is a file), and every stub call is
// logged so a run's mutating calls can be counted. The target is a temp root. Nothing touches a real host.
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
import { dirname, join } from 'node:path';
import { afterAll, it } from 'vitest';
import { DEPLOY, posix, SH } from './colo-deploy-fixture';

export const BOOT = join(DEPLOY, 'genesis', 'bootstrap.sh');
// The script needs bash (pipefail, [[ ]]). SH is dash on Ubuntu CI; on Windows it is Git's sh.exe, and bash.exe is beside it.
export const BASH =
  process.platform === 'win32' && SH !== 'sh' ? join(dirname(SH), 'bash.exe') : 'bash';
// Test values, not Docker's key: the gpg stub prints them and the bootstrap matches them. The real pin is owner-supplied.
export const FPR = '0123456789ABCDEF0123456789ABCDEF01234567';
export const WRONG_FPR = 'FEDCBA9876543210FEDCBA9876543210FEDCBA98';
export const CANARY = 'CANARY-SECRET-7f3a';
const HAS_JQ =
  spawnSync(SH, ['-c', 'command -v jq'], { env: { PATH: '/usr/bin:/bin' } }).status === 0;
// Verbs that change a host. Reads (nft list, sysctl -n, getent, stat) are not here; a dry run must match none of these.
export const MUTATING =
  /^(apt-get (install|update)|apt-mark (un)?hold|systemctl (enable|restart)|useradd|groupadd|install|nft -f|sysctl -q -p|curl|tee|mktemp|chown)( |$)/;
export const DEBIAN_12 = 'ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n';
export const DEBIAN_13 = 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n';

// A test that needs jq (the docker step merges daemon.json with it). Locally it is skipped without jq; in CI, where jq
// is installed, its absence fails the test.
export function jqTest(name: string, fn: () => void): void {
  if (HAS_JQ) it(name, fn);
  else if (process.env.CI) {
    it(name, () => {
      throw new Error('jq is required in CI for this test');
    });
  } else it.skip(name, fn);
}

// Stub preamble: every call is logged; last_arg returns the final argument.
const PRE = `echo "$(basename "$0") $*" >>"$STUB_LOG"
last_arg() { for a in "$@"; do last=$a; done; printf '%s' "$last"; }
`;
// A logging pass-through to the real binary, for verbs the stubs must see (tee, mktemp, chown).
const real = (name: string) => `PATH=/usr/bin:/bin\nexec ${name} "$@"\n`;
export const STUBS: Record<string, string> = {
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
  getent: `db=$1; key=$2
case "$db" in passwd) dir=$STUB_STATE/users ;; group) dir=$STUB_STATE/groups ;; *) exit 2 ;; esac
for f in "$dir"/*; do
  [ -f "$f" ] || continue
  name=$(basename "$f"); read -r u g <"$f"
  if [ "$name" = "$key" ] || [ "$u" = "$key" ]; then
    if [ "$db" = passwd ]; then echo "$name:x:$u:$g::/home/$name:/bin/sh"; else echo "$name:x:$u:"; fi
    exit 0
  fi
done
exit 2
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
  is-active) [ -f "$STUB_STATE/active/$unit" ] ;;
  cat) [ -f "$STUB_STATE/units/$unit" ] ;;
  enable) touch "$STUB_STATE/svc/$unit" ;;
  restart) [ ! -f "$STUB_STATE/restart-fail" ] ;;
  *) exit 0 ;;
esac
`,
  'apt-mark': `case "$1" in
  showhold) ls "$STUB_STATE/holds" 2>/dev/null ;;
  hold) shift; for p in "$@"; do touch "$STUB_STATE/holds/$p"; done ;;
  unhold) shift; for p in "$@"; do rm -f "$STUB_STATE/holds/$p"; done ;;
esac
exit 0
`,
  curl: `out=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; esac; shift; done
echo 'stub key block' >"$out"
`,
  gpg: `echo "pub:-:4096:1:ABCD1234:0:::::"
echo "fpr:::::::::$STUB_FPR:"
if [ -f "$STUB_STATE/gpg-extra" ]; then
  echo "pub:-:4096:1:EF01:0:::::"
  echo "fpr:::::::::$(cat "$STUB_STATE/gpg-extra"):"
fi
`,
  git: 'echo "git version $(cat "$STUB_STATE/git-version")"\n',
  id: 'echo 0\n',
  docker: 'exit 0\n',
  nft: `case "$1" in
  -c) [ ! -f "$STUB_STATE/nft-fail" ] ;;
  -f) [ ! -f "$STUB_STATE/nft-fail" ] && touch "$STUB_STATE/nft-loaded" ;;
  list) [ -f "$STUB_STATE/nft-loaded" ] ;;
  *) exit 0 ;;
esac
`,
  sysctl: `if [ "$1" = -n ]; then cat "$STUB_STATE/sysctl/$2" 2>/dev/null; exit 0; fi
grep '=' "$3" | while read -r k _ v; do printf '%s' "$v" >"$STUB_STATE/sysctl/$k"; done
`,
  sshd: `[ "$1" = -T ] && cat "$STUB_STATE/sshd-config"
exit 0
`,
  ss: 'exit 0\n',
  tee: real('tee'),
  mktemp: real('mktemp'),
  chown: real('chown'),
};

export interface Host {
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

// An absolute path as the script sees it: on Windows, C:\x\y becomes /c/x/y (Git Bash). Unchanged on Linux.
const bashAbs = (p: string) =>
  posix(p).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);

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
    GELDAR_DOCKER_KEY_FPR: FPR,
    GELDAR_PUBLIC_TCP_PORTS: '25565',
    GELDAR_STATE_DIR: bashAbs(join(root, 'var/lib/geldar-test')),
    GELDAR_SECRETS_DIR: bashAbs(join(root, 'etc/geldar-test/secrets')),
    GELDAR_TOKENS_DIR: bashAbs(join(root, 'etc/geldar-test/tokens')),
    GELDAR_SRC_DIR: bashAbs(join(root, 'opt/geldar-test/src')),
  };
}

export function makeHost(
  opts: { git?: string; osRelease?: string; drop?: string[]; extra?: string[] } = {},
): Host {
  const root = tempDir();
  const sandbox = tempDir();
  const bin = join(sandbox, 'bin');
  mkdirSync(bin);
  for (const d of ['pkgs', 'users', 'groups', 'attrs', 'svc', 'holds', 'active', 'units', 'sysctl'])
    mkdirSync(join(sandbox, 'state', d), { recursive: true });
  const state = (...p: string[]) => join(sandbox, 'state', ...p);
  writeFileSync(state('git-version'), opts.git ?? '2.52.0');
  writeFileSync(state('sshd-config'), 'port 22\n');
  writeFileSync(state('units', 'systemd-timesyncd'), '');
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

// A file of the host's stub state (sshd config, active units, loaded nft table, and so on).
export const st = (h: Host, ...p: string[]) => join(h.sandbox, 'state', ...p);

export interface Run {
  code: number;
  out: string;
  calls: string[];
}
function readCalls(host: Host): string[] {
  return existsSync(host.log) ? readFileSync(host.log, 'utf8').split('\n').filter(Boolean) : [];
}
// run: the script under bash with the stubs first on PATH. extra overrides the environment (for example STUB_FPR).
export function run(host: Host, args: string[], extra: Record<string, string> = {}): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^path$/i.test(k)) env[k] = v;
  const path = join(host.sandbox, 'bin');
  const res = spawnSync(BASH, [posix(BOOT), posix(host.env), ...args], {
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
      // No SSH session by default: the sshd guard reads SSH_CONNECTION, which a developer shell may set.
      SSH_CONNECTION: '',
      ...extra,
    },
  });
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, calls: readCalls(host) };
}
export const mutating = (calls: string[]) => calls.filter((c) => MUTATING.test(c));
export const indexOfCall = (calls: string[], re: RegExp) => calls.findIndex((c) => re.test(c));

// Every file under the target root, by path relative to it.
export function snapshot(
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
