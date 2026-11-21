// Tests for deploy/nf-fetch-extra-mods.sh (GE-02c): fetches the NeoForge extra mod jars named in compose/neoforge/extra-mods.sources
// and verifies each one against its pin (sha256, from the pins file) and its sources line (sha512). The script runs under bash with a
// stub `curl` first on PATH, and a shell function of the same name (Windows PATH lookup differs). The stub logs its arguments and
// copies a fixture, named by the URL's file name, to the -o target. Nothing goes to the network: every URL is on example.invalid.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SH } from './colo-admin-fixture';

const SCRIPT = join(
  fileURLToPath(new URL('../../', import.meta.url)),
  'deploy',
  'nf-fetch-extra-mods.sh',
).replaceAll('\\', '/');
const HOST = 'https://downloads.example.invalid/mods';
const WIN = process.platform === 'win32';

const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');
const sha512Hex = (text: string) => createHash('sha512').update(text).digest('hex');

const STUB = `#!/bin/sh
# Stub curl: logs its arguments, then copies the fixture named by the URL's file name to the -o target. FAKE_CURL_FAIL=1 fails.
printf '%s\\n' "$*" >>"$FAKE_LOG"
out=""
prev=""
url=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out=$a; fi
  prev=$a
  url=$a
done
if [ -n "\${FAKE_CURL_FAIL:-}" ]; then echo "curl: (22) fake failure" >&2; exit 22; fi
name=\${url##*/}
[ -f "$FAKE_FIXTURES/$name" ] || { echo "fake curl: no fixture for $name" >&2; exit 22; }
cp "$FAKE_FIXTURES/$name" "$out"
`;

interface Line {
  jar: string;
  // The bytes the server serves. Default: the jar name.
  body?: string;
  // The sha256 in the pins file. Default: the sha256 of the served bytes. null: the jar has no pin.
  pin?: string | null;
  // The sha512 on the sources line. Default: the sha512 of the served bytes.
  sha512?: string;
  url?: string;
}

interface Setup {
  dir: string;
  dest: string;
  fixtures: string;
  stub: string;
  log: string;
  sources: string;
  pins: string;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Every path is written with forward slashes: the script runs under bash, which takes them on Windows too.
function setUp(lines: Line[]): Setup {
  const dir = mkdtempSync(join(tmpdir(), 'nf-fetch-extra-')).replaceAll('\\', '/');
  dirs.push(dir);
  const s: Setup = {
    dir,
    dest: `${dir}/dest`,
    fixtures: `${dir}/fixtures`,
    stub: `${dir}/bin/curl`,
    log: `${dir}/curl.log`,
    sources: `${dir}/extra-mods.sources`,
    pins: `${dir}/extra-mods.pins`,
  };
  for (const d of [s.dest, s.fixtures, `${dir}/bin`]) mkdirSync(d);
  writeFileSync(s.stub, STUB);
  const sources = ['# test download sources'];
  const pins = ['# test pins: <name> <sha256> <jar> <version>'];
  lines.forEach((l, i) => {
    const body = l.body ?? l.jar;
    writeFileSync(`${s.fixtures}/${l.jar}`, body);
    const pin = l.pin === undefined ? sha256Hex(body) : l.pin;
    if (pin !== null) pins.push(`mod${i} ${pin} ${l.jar} 1.0.0`);
    sources.push(`${l.jar} ${l.url ?? `${HOST}/${l.jar}`} ${l.sha512 ?? sha512Hex(body)}`);
  });
  writeFileSync(s.sources, `${sources.join('\n')}\n`);
  writeFileSync(s.pins, `${pins.join('\n')}\n`);
  return s;
}

interface RunOpts {
  dest?: string;
  failCurl?: boolean;
}

function run(s: Setup, opts: RunOpts = {}) {
  // On Windows the spawn gets only Git for Windows' tools (see colo-admin-fixture.ts): the bash on PATH may be WSL's.
  const tools =
    process.platform === 'win32'
      ? [dirname(SH), join(dirname(SH), '..', '..', 'mingw64', 'bin')]
      : [];
  const path = [
    dirname(s.stub),
    ...tools,
    process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
  ]
    .filter(Boolean)
    .join(delimiter);
  // The function wins over PATH, so the stub is used on Windows too. The positional parameters are the script's arguments.
  const r = spawnSync(
    SH,
    [
      '-c',
      `curl() { sh "${s.stub}" "$@"; }\n. "${SCRIPT}" "$@"`,
      'sh',
      s.sources,
      s.pins,
      opts.dest ?? s.dest,
    ],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: path,
        Path: path,
        FAKE_FIXTURES: s.fixtures,
        FAKE_LOG: s.log,
        FAKE_CURL_FAIL: opts.failCurl ? '1' : '',
      },
    },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const calls = (s: Setup): string[] =>
  existsSync(s.log) ? readFileSync(s.log, 'utf8').trim().split('\n').filter(Boolean) : [];
const placed = (s: Setup): string[] => readdirSync(s.dest).sort();
const text = (path: string): string => readFileSync(path, 'utf8');

describe('nf-fetch-extra-mods.sh: fetch and verify (stub curl, no network)', () => {
  it('fetches two jars into the dest dir, each verified against both digests', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }, { jar: 'beta-2.0.jar' }]);
    const r = run(s);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('fetched: Alpha-1.0.jar');
    expect(r.out).toContain('fetched: beta-2.0.jar');
    expect(text(`${s.dest}/Alpha-1.0.jar`)).toBe('Alpha-1.0.jar');
    expect(text(`${s.dest}/beta-2.0.jar`)).toBe('beta-2.0.jar');
    expect(placed(s)).toEqual(['Alpha-1.0.jar', 'beta-2.0.jar']);
    expect(calls(s)).toHaveLength(2);
  });

  it('a second run leaves matching jars alone: unchanged, and curl is not called', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }, { jar: 'beta-2.0.jar' }]);
    expect(run(s).code).toBe(0);
    const before = calls(s).length;
    const r = run(s);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('unchanged: Alpha-1.0.jar');
    expect(r.out).toContain('unchanged: beta-2.0.jar');
    expect(calls(s)).toHaveLength(before);
  });

  it('replaces a stale jar that matches neither digest', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    writeFileSync(`${s.dest}/Alpha-1.0.jar`, 'stale');
    const r = run(s);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('fetched: Alpha-1.0.jar');
    expect(text(`${s.dest}/Alpha-1.0.jar`)).toBe('Alpha-1.0.jar');
  });

  it('refuses a tampered jar (sha256 mismatch): nothing is placed and no temp file is left', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar', body: 'tampered', pin: sha256Hex('original') }]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('nf-fetch-extra-mods: Alpha-1.0.jar does not match its pins');
    expect(placed(s)).toEqual([]);
    expect(calls(s)).toHaveLength(1);
  });

  it('refuses a jar whose sha512 does not match its sources line', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar', sha512: sha512Hex('other') }]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Alpha-1.0.jar does not match its pins');
    expect(placed(s)).toEqual([]);
  });

  it.each(['UNSET', 'abc'])('refuses the sha512 %s before any download', (sha512) => {
    const s = setUp([{ jar: 'Alpha-1.0.jar', sha512 }]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Alpha-1.0.jar');
    expect(calls(s)).toHaveLength(0);
    expect(placed(s)).toEqual([]);
  });

  it('refuses an http URL before any download', () => {
    const s = setUp([
      { jar: 'Alpha-1.0.jar', url: 'http://downloads.example.invalid/mods/Alpha-1.0.jar' },
    ]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not an https URL');
    expect(calls(s)).toHaveLength(0);
  });

  it('refuses a jar that has no pin in the pins file', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar', pin: null }]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Alpha-1.0.jar has no single sha256 pin');
    expect(calls(s)).toHaveLength(0);
    expect(placed(s)).toEqual([]);
  });

  it.skipIf(WIN)('refuses a dest dir that is a symlink', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    const real = `${s.dir}/real`;
    mkdirSync(real);
    symlinkSync(real, `${s.dir}/link`, 'dir');
    const r = run(s, { dest: `${s.dir}/link` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('is a symlink');
    expect(calls(s)).toHaveLength(0);
    expect(readdirSync(real)).toEqual([]);
  });

  it('refuses a dest dir that does not exist', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    const r = run(s, { dest: `${s.dir}/missing` });
    expect(r.code).toBe(1);
    expect(r.out).toContain('missing or not a directory');
    expect(calls(s)).toHaveLength(0);
  });

  it.each(['.hidden.jar', 'bad$name.jar', 'a,b.jar'])('refuses the unsafe jar name %s', (jar) => {
    const s = setUp([{ jar }]);
    const r = run(s);
    expect(r.code).toBe(1);
    expect(r.out).toContain('is unsafe');
    expect(calls(s)).toHaveLength(0);
    expect(placed(s)).toEqual([]);
  });

  it('a curl failure leaves the old jar in place and no temp file behind', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    writeFileSync(`${s.dest}/Alpha-1.0.jar`, 'old bytes');
    const r = run(s, { failCurl: true });
    expect(r.code).toBe(1);
    expect(r.out).toContain('the download of Alpha-1.0.jar failed');
    expect(text(`${s.dest}/Alpha-1.0.jar`)).toBe('old bytes');
    expect(placed(s)).toEqual(['Alpha-1.0.jar']);
  });

  it('passes curl the https-only flag, -f and the time and redirect limits', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    expect(run(s).code).toBe(0);
    const [line = ''] = calls(s);
    const words = line.split(' ');
    expect(words[words.indexOf('--proto') + 1]).toBe('=https');
    expect(words[words.indexOf('--proto-redir') + 1]).toBe('=https');
    expect(words).toContain('-fsS');
    expect(words).toContain('--max-redirs');
    expect(words).toContain('--max-time');
    expect(words.at(-1)).toBe(`${HOST}/Alpha-1.0.jar`);
  });

  it.skipIf(WIN)('places the jar with mode 0644', () => {
    const s = setUp([{ jar: 'Alpha-1.0.jar' }]);
    expect(run(s).code).toBe(0);
    expect(statSync(`${s.dest}/Alpha-1.0.jar`).mode & 0o777).toBe(0o644);
  });
});
