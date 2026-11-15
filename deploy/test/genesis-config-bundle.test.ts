// G1-03: deploy/genesis/build-config-bundle.sh packs the config a target needs into one deterministic archive. Its
// allowlist is deploy/genesis/config-bundle.list (the golden contents). The archive must rebuild byte for byte, hold
// exactly the golden paths, render the default Colo config like the golden fixture when extracted alone, and never
// hold a secret, env file, key or node-only file.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEPLOY, posix, SH } from './colo-deploy-fixture';

const ROOT_DIR = resolve(DEPLOY, '..');
const SCRIPT = join(DEPLOY, 'genesis', 'build-config-bundle.sh');
const LIST = join(DEPLOY, 'genesis', 'config-bundle.list');
const GOLDEN_RENDER = join(DEPLOY, 'test', 'fixtures', 'colo-default-config.yml');
const ARCHIVE = 'config-bundle.tar.gz';
// Paths that must never reach the bundle. The list is the allowlist; this is the guard that checks it.
const FORBIDDEN: [string, RegExp][] = [
  ['secrets/', /(^|\/)secrets\//],
  ['*.env', /\.env$/],
  ['*.pem', /\.pem$/],
  ['nats-auth.conf', /(^|\/)nats-auth\.conf$/],
  ['node.env', /(^|\/)node\.env$/],
];
// Variables that change the default render: the compose files read these with defaults, so a developer's shell must
// not reach the test. Same idea as tools/repo-checks/src/colo-params.test.ts.
const RENDER_VAR = /^(GELDAR_|COMPOSE_|REGISTER_)/;

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'geldar-bundle-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** The golden contents: the list's paths, comments and blank lines dropped, sorted. */
function golden(): string[] {
  return readFileSync(LIST, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .sort();
}

// The script needs the coreutils (dirname, mktemp, sort, gzip, tar). On Windows, Git for Windows' sh finds them only
// on its own PATH, the same rule as the Colo deploy fixture (which also drops the full Windows PATH).
function shEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.Path;
  if (SH !== 'sh') {
    env.PATH = [dirname(SH), join(dirname(SH), '..', '..', 'mingw64', 'bin')].join(delimiter);
  }
  return env;
}

function build(out: string, script = SCRIPT) {
  return spawnSync(SH, [posix(script), posix(out)], { encoding: 'utf8', env: shEnv() });
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The names in an archive, in the order tar stores them. */
function archiveNames(archive: string): string[] {
  const r = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split(/\r?\n/).filter((line) => line !== '');
}

function forbiddenHits(paths: string[]): string[] {
  return paths.flatMap((p) =>
    FORBIDDEN.filter(([, re]) => re.test(p)).map(([name]) => `${p} (${name})`),
  );
}

// Each build forks about ten commands; under Git for Windows' sh on a desktop that is seconds per fork, so a build test
// takes up to tens of seconds. The bound is for that real work, not a retry.
const BUILD_TIMEOUT_MS = 240_000;

describe('build-config-bundle.sh: determinism', { timeout: BUILD_TIMEOUT_MS }, () => {
  it('builds the same archive twice: identical sha256 and the printed digest is that sha256', () => {
    const a = tempDir();
    const b = tempDir();
    const first = build(a);
    const second = build(b);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const digest = sha256File(join(a, ARCHIVE));
    expect(sha256File(join(b, ARCHIVE))).toBe(digest);
    expect(first.stdout.trim()).toBe(digest);
    expect(second.stdout.trim()).toBe(digest);
    expect(readFileSync(join(a, 'config-bundle.sha256'), 'utf8')).toBe(`${digest}  ${ARCHIVE}\n`);
    expect(readFileSync(join(a, 'config-bundle.manifest'), 'utf8')).toBe(
      readFileSync(join(b, 'config-bundle.manifest'), 'utf8'),
    );
  });

  it('fails when a listed file is missing from the tree, and writes no archive', () => {
    // A copy of the script under a temp root whose list names a file that does not exist.
    const root = tempDir();
    const genesis = join(root, 'deploy', 'genesis');
    mkdirSync(genesis, { recursive: true });
    copyFileSync(SCRIPT, join(genesis, 'build-config-bundle.sh'));
    writeFileSync(join(genesis, 'config-bundle.list'), 'deploy/no-such-file.sh\n');
    const out = tempDir();
    const r = build(out, join(genesis, 'build-config-bundle.sh'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('listed file is missing from the tree: deploy/no-such-file.sh');
    expect(existsSync(join(out, ARCHIVE))).toBe(false);
  });
});

describe('build-config-bundle.sh: contents', { timeout: BUILD_TIMEOUT_MS }, () => {
  it('holds exactly the golden list, in sorted order, with a manifest line per file', () => {
    const out = tempDir();
    expect(build(out).status).toBe(0);
    const names = archiveNames(join(out, ARCHIVE));
    expect(names).toEqual(golden());
    const manifest = readFileSync(join(out, 'config-bundle.manifest'), 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(manifest.map((line) => line.split('  ')[1])).toEqual(golden());
    for (const line of manifest) {
      const [hash, path] = line.split('  ');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(sha256File(join(ROOT_DIR, path)));
    }
  });

  it.skipIf(spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0)(
    'extracted alone into a clean directory, renders the default config byte for byte like the golden',
    () => {
      const out = tempDir();
      expect(build(out).status).toBe(0);
      const clean = tempDir();
      const x = spawnSync('tar', ['-xzf', join(out, ARCHIVE), '-C', clean], { encoding: 'utf8' });
      expect(x.status, x.stderr).toBe(0);
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const name of Object.keys(env)) if (RENDER_VAR.test(name)) delete env[name];
      const r = spawnSync(
        'docker',
        [
          'compose',
          '-f',
          join(clean, 'compose', 'colo.yml'),
          '-f',
          join(clean, 'compose', 'nats-auth.yml'),
          'config',
          '--no-path-resolution',
        ],
        { cwd: clean, env, encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(readFileSync(GOLDEN_RENDER, 'utf8'));
    },
  );
});

describe('build-config-bundle.sh: forbidden paths', { timeout: BUILD_TIMEOUT_MS }, () => {
  it('no listed path is a secret, an env file, a key or a node-only file', () => {
    expect(forbiddenHits(golden())).toEqual([]);
  });

  it('the built archive holds no such path', () => {
    const out = tempDir();
    expect(build(out).status).toBe(0);
    expect(forbiddenHits(archiveNames(join(out, ARCHIVE)))).toEqual([]);
  });

  it('the guard itself catches each forbidden shape', () => {
    const samples = [
      'compose/secrets/rcon.txt',
      'deploy/secrets/x',
      'compose/.env',
      'deploy/node.env',
      'deploy/release.pem',
      'secrets/x',
      'compose/nats-auth.conf',
    ];
    for (const p of samples) expect(forbiddenHits([p]), p).not.toEqual([]);
    // The allowed neighbours: an overlay named after nats-auth, a template ending in .env.example.
    for (const p of [
      'compose/nats-auth.yml',
      'deploy/release.env.example',
      'deploy/compose.secrets.yml',
    ])
      expect(forbiddenHits([p]), p).toEqual([]);
  });
});
