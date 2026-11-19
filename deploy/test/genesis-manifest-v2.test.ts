// G1-04 (release manifest v2, decision 0188): release.env gains optional GELDAR_* digest keys. The old manifest still
// validates, and colo-cd's loader (deploy/common.sh load_release, reached through colo-cd.sh) ignores every key that is
// not an *_IMAGE line. The validator is deploy/genesis/manifest.sh. Both run under the same sh the other deploy tests use.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_SH = join(DEPLOY, 'genesis', 'manifest.sh');
const COLO_CD = join(DEPLOY, 'colo-cd.sh');
const COMMON = join(DEPLOY, 'common.sh');
const posix = (p: string) => p.replace(/\\/g, '/');
const SH =
  process.env.GELDAR_TEST_SH ??
  (process.platform !== 'win32'
    ? 'sh'
    : ([process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter((p): p is string => Boolean(p))
        .map((r) => join(r, 'Git', 'usr', 'bin', 'sh.exe'))
        .find((p) => existsSync(p)) ?? 'sh'));

const hex = (ch: string) => ch.repeat(64);
const IMAGE_NAMES = ['BODY', 'MIND', 'EVENTSINK', 'MCP', 'ADMIN', 'GLASS', 'REGISTER'];
const IMAGE_LINES = IMAGE_NAMES.map(
  (n, i) =>
    `GELDAR_${n}_IMAGE=ghcr.io/sandboxservers/geldar-${n.toLowerCase()}@sha256:${String(i).repeat(64)}`,
);
// The shape colo-images.yml writes today (no v2 keys).
const V1 = [
  `# Release manifest for the Colo node (decision 0084). Commit ${'c'.repeat(40)}.`,
  ...IMAGE_LINES,
]
  .join('\n')
  .concat('\n');
const V2_KEYS = [
  'GELDAR_MANIFEST_VERSION=2',
  `GELDAR_PLUGIN_CORE_SHA256=${hex('1')}`,
  `GELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256=${hex('2')}`,
  `GELDAR_CONFIG_BUNDLE_SHA256=${hex('3')}`,
  `GELDAR_ENV_DEFINITION_SHA256=${hex('4')}`,
];
const V2 = `${V1}${V2_KEYS.join('\n')}\n`;
const BODY_LINE = IMAGE_LINES[0] as string;

let dir: string;
let seq = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'genesis-manifest-v2-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(text: string): string {
  seq += 1;
  const p = join(dir, `release-${seq}.env`);
  writeFileSync(p, text);
  return posix(p);
}

function env(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${dirname(SH)}${delimiter}${process.env.PATH ?? ''}` };
}

// The validator and its CLI: manifest.sh <validate|value|version> <file> [KEY].
function manifest(args: string[]): { code: number; out: string } {
  const r = spawnSync(SH, [posix(MANIFEST_SH), ...args], { encoding: 'utf8', env: env() });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

// colo-cd's loader: deploy/common.sh load_release, sourced the way colo-cd.sh sources it (arg0 is colo-cd.sh so
// DEPLOY_DIR resolves). It prints the body image it exported.
function loader(file: string): { code: number; out: string } {
  const script = ['. "$1"', 'load_release "$2"', 'printf "%s\\n" "$GELDAR_BODY_IMAGE"'].join('\n');
  const r = spawnSync(SH, ['-c', script, posix(COLO_CD), posix(COMMON), file], {
    encoding: 'utf8',
    env: env(),
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('release manifest v2: the validator (deploy/genesis/manifest.sh)', () => {
  it('an old manifest with only image lines validates, and is version 1', () => {
    const f = write(V1);
    expect(manifest(['validate', f]).code).toBe(0);
    expect(manifest(['version', f]).out.trim()).toBe('1');
  });

  it('a v2 manifest validates and reads its digests back by key', () => {
    const f = write(V2);
    expect(manifest(['validate', f]).code).toBe(0);
    expect(manifest(['version', f]).out.trim()).toBe('2');
    const core = manifest(['value', f, 'GELDAR_PLUGIN_CORE_SHA256']);
    expect(core.code).toBe(0);
    expect(core.out.trim()).toBe(hex('1'));
  });

  it('a v2 manifest with no digest keys still validates (the keys are optional)', () => {
    const f = write(`${V1}GELDAR_MANIFEST_VERSION=2\n`);
    expect(manifest(['validate', f]).code).toBe(0);
  });

  it.each([
    ['too short', 'ab'.repeat(31)],
    ['too long', 'ab'.repeat(33)],
    ['upper case', 'AB'.repeat(32)],
    ['a sha256: prefix', `sha256:${'ab'.repeat(32)}`],
    ['not hex', 'zz'.repeat(32)],
  ])('a bad digest shape (%s) is refused, and the error names the key only', (_label, bad) => {
    const f = write(
      V2.replace(`GELDAR_CONFIG_BUNDLE_SHA256=${hex('3')}`, `GELDAR_CONFIG_BUNDLE_SHA256=${bad}`),
    );
    const r = manifest(['validate', f]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('GELDAR_CONFIG_BUNDLE_SHA256');
    expect(r.out).not.toContain(bad);
  });

  it('a GELDAR_MANIFEST_VERSION other than 2 is refused', () => {
    const f = write(V2.replace('GELDAR_MANIFEST_VERSION=2', 'GELDAR_MANIFEST_VERSION=3'));
    const r = manifest(['validate', f]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('GELDAR_MANIFEST_VERSION');
  });

  it('a digest key listed twice is refused', () => {
    const f = write(`${V2}GELDAR_PLUGIN_CORE_SHA256=${hex('5')}\n`);
    const r = manifest(['validate', f]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('GELDAR_PLUGIN_CORE_SHA256');
  });

  it('a line that is not KEY=VALUE is refused by line number, not by content', () => {
    const f = write(`${V2}not a key line\n`);
    const r = manifest(['validate', f]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('line');
    expect(r.out).not.toContain('not a key line');
  });

  it('value refuses an absent key', () => {
    const f = write(V1);
    expect(manifest(['value', f, 'GELDAR_PLUGIN_CORE_SHA256']).code).toBe(1);
  });
});

describe("colo-cd's loader (deploy/common.sh load_release) with the v2 keys", () => {
  it('loads the old manifest and exports its body image', () => {
    const r = loader(write(V1));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(BODY_LINE.replace('GELDAR_BODY_IMAGE=', ''));
  });

  it('loads a v2 manifest and exports the same body image', () => {
    const r = loader(write(V2));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(BODY_LINE.replace('GELDAR_BODY_IMAGE=', ''));
  });

  it('ignores an unknown key that is not an image (the parser does not die on it)', () => {
    const r = loader(write(`${V2}GELDAR_SOME_FUTURE_KEY=anything\n`));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(BODY_LINE.replace('GELDAR_BODY_IMAGE=', ''));
  });

  it('still refuses a tag on an image line', () => {
    const f = write(
      V2.replace(BODY_LINE, 'GELDAR_BODY_IMAGE=ghcr.io/sandboxservers/geldar-body:latest'),
    );
    const r = loader(f);
    expect(r.code).toBe(1);
    expect(r.out).toContain('latest');
  });

  it('still refuses a key name that is not upper case', () => {
    const r = loader(write(`${V2}geldar_lower=1\n`));
    expect(r.code).toBe(1);
  });
});
