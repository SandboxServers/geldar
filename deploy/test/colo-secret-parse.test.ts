// C2-07g: the secret check reads only the merged config's top-level secrets, and a bind mount's source never carries
// over to a later item's target. The fixture is a real `docker compose config` capture of colo.yml + nats-auth.yml +
// compose.secrets.yml, paths scrubbed to /REPO and /SECRETS. In it the nats service has nats-auth.conf as a SERVICE
// secret, and an earlier service bind-mounts shards/colo-mind.yaml; the old parser refused that bind source as
// "outside the secrets directory". check_secrets runs from common.sh with a stubbed `dc` and `stat`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const posix = (p: string) => p.replace(/\\/g, '/');
const SH =
  process.env.GELDAR_TEST_SH ??
  (process.platform !== 'win32'
    ? 'sh'
    : ([process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter((p): p is string => Boolean(p))
        .map((r) => join(r, 'Git', 'usr', 'bin', 'sh.exe'))
        .find((p) => existsSync(p)) ?? 'sh'));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function checkSecrets(config: string, secretFiles: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-secret-parse-'));
  dirs.push(dir);
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of secretFiles) writeFileSync(join(secrets, f), 'test-value\n');
  writeFileSync(join(dir, 'config.yml'), config.replaceAll('/SECRETS', posix(secrets)));
  const script = `. "$1"
cfg=$2
dc() { case $* in *--quiet*) return 0 ;; esac; cat "$cfg"; }
stat() { case $2 in %a) echo 600 ;; *) echo 1000 ;; esac; }
GELDAR_SECRETS_DIR=$3
GELDAR_SERVICE_UID=1000
check_secrets`;
  const r = spawnSync(
    SH,
    [
      '-c',
      script,
      posix(join(DEPLOY, 'colo-up.sh')),
      posix(join(DEPLOY, 'common.sh')),
      posix(join(dir, 'config.yml')),
      posix(secrets),
    ],
    {
      encoding: 'utf8',
      // dirname, mktemp and readlink come from the same directory as sh (Git for Windows' usr/bin).
      env: { ...process.env, PATH: `${dirname(SH)}${delimiter}${process.env.PATH ?? ''}` },
    },
  );
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('check_secrets on a real merged config (C2-07g)', () => {
  const text = readFileSync(join(DEPLOY, 'test', 'fixtures', 'colo-merged-config.yml'), 'utf8');
  const files = [...text.matchAll(/file: \/SECRETS\/(\S+)/g)].map((m) => m[1] as string);

  it('passes: the nats-auth.conf service secret is not confused with an earlier bind mount', () => {
    expect(files).toContain('nats-auth.conf');
    const r = checkSecrets(text, files);
    expect(r.out).not.toContain('resolves outside');
    expect(r.out).not.toContain('bind mount');
    expect(r.code).toBe(0);
    expect(r.out).toContain('secret files: each file the merged config declares');
  });

  it('still refuses a missing top-level secret file', () => {
    const r = checkSecrets(
      text,
      files.filter((f) => f !== 'rcon.txt'),
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: rcon.txt');
  });
});
