/**
 * The NeoForge entrypoint (compose/neoforge/neoforge-entrypoint.sh) run for real under sh. A stub curl on PATH copies a
 * fixture to the -o target and logs the call; the GELDAR_NF_* seams point the script at a temp data dir, a temp secret
 * file and a stub start command. The pinned hashes are overridden with the fixtures' hashes, so the real pins are only
 * read from the script text (the last test). Nothing here needs Docker or the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const ENTRY_TEXT = readFileSync(ENTRY, 'utf8');
/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_NAME = 'proxy-compatible-forge-1.3.1.jar';
const INSTALLER_NAME = `neoforge-${BUILD}-installer.jar`;
/** A recognizable secret: the tests check it never reaches stdout or stderr. */
const SECRET = 'nf-test-secret-Q7_x';
const MOD_BODY = 'fixture mod bytes';
const INSTALLER_BODY = 'fixture installer bytes';

/** Serves the fixture named by the URL's last path part, and logs each call. */
const CURL_STUB = [
  '#!/bin/sh',
  'echo "$*" >>"$STUB_CURL_LOG"',
  'out=""; url=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -o) out=$2; shift ;;',
  '    http*) url=$1 ;;',
  '  esac',
  '  shift',
  'done',
  'cp "$STUB_CURL_FIXTURES/$(basename "$url")" "$out"',
  '',
].join('\n');

const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface Case {
  bin: string;
  data: string;
  config: string;
  mod: string;
  installer: string;
  curlLog: string;
  env: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temp tree with the stub bin, the fixtures, the secret file and the start stub. */
function setup(secret = `${SECRET}\n`): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-entry-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const fixtures = join(base, 'fixtures');
  const data = join(base, 'data');
  for (const dir of [bin, fixtures, data]) mkdirSync(dir);
  writeFileSync(join(fixtures, MOD_NAME), MOD_BODY);
  writeFileSync(join(fixtures, INSTALLER_NAME), INSTALLER_BODY);
  writeFileSync(join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'start'), '#!/bin/sh\necho "started $*"\n', { mode: 0o755 });
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, secret);
  const curlLog = join(base, 'curl.log');
  return {
    bin,
    data,
    config: join(data, 'config', 'proxy-compatible-forge.toml'),
    mod: join(data, 'mods', 'proxy-compatible-forge.jar'),
    installer: join(data, 'neoforge-installer.jar'),
    curlLog,
    env: {
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(join(bin, 'start')),
      GELDAR_NF_MOD_SHA512: sha512(MOD_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      NEOFORGE_VERSION: BUILD,
      STUB_CURL_LOG: slash(curlLog),
      STUB_CURL_FIXTURES: slash(fixtures),
    },
  };
}

/** Runs the entrypoint under sh with the stub curl first on PATH. */
function run(c: Case, extra: Record<string, string> = {}, args: string[] = []) {
  return spawnSync('sh', [slash(ENTRY), ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${c.bin}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      ...c.env,
      ...extra,
    },
  });
}

const curlCalls = (c: Case) =>
  existsSync(c.curlLog) ? readFileSync(c.curlLog, 'utf8').split('\n').filter(Boolean).length : 0;

function expectNoSecret(out: { stdout: string; stderr: string }) {
  expect(out.stdout + out.stderr).not.toContain(SECRET);
}

describe.skipIf(skipWithoutSh())('NeoForge entrypoint under sh', { timeout: 30_000 }, () => {
  it('a mod download that does not match its pinned sha512 exits 1 and is deleted', () => {
    const c = setup();
    const r = run(c, { GELDAR_NF_MOD_SHA512: '0'.repeat(128) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('does not match its pinned sha512sum hash; deleted it');
    expect(existsSync(c.mod)).toBe(false);
    expect(existsSync(`${c.mod}.part`)).toBe(false);
    expect(curlCalls(c)).toBe(1);
    expectNoSecret(r);
  });

  it('an installer download that does not match its pinned sha256 exits 1 and is deleted', () => {
    const c = setup();
    const r = run(c, { GELDAR_NF_INSTALLER_SHA256: '0'.repeat(64) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('does not match its pinned sha256sum hash; deleted it');
    expect(existsSync(c.installer)).toBe(false);
    expect(existsSync(`${c.installer}.part`)).toBe(false);
    expect(existsSync(c.mod)).toBe(true);
    expectNoSecret(r);
  });

  it('matching downloads are kept, and a rerun does not call curl again', () => {
    const c = setup();
    const first = run(c);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('started');
    expect(curlCalls(c)).toBe(2);
    expect(readFileSync(c.mod, 'utf8')).toBe(MOD_BODY);
    expect(readFileSync(c.installer, 'utf8')).toBe(INSTALLER_BODY);
    const second = run(c);
    expect(second.status).toBe(0);
    expect(curlCalls(c)).toBe(2);
    expectNoSecret(first);
    expectNoSecret(second);
  });

  it('the curl calls carry the connect timeout, the total timeout and the retry count', () => {
    const c = setup();
    expect(run(c).status).toBe(0);
    const calls = readFileSync(c.curlLog, 'utf8');
    expect(calls).toContain('--connect-timeout 30 --max-time 600 --retry 3');
  });

  it('a fresh config is written with the secret only in [forwarding], mode 600 where modes exist', () => {
    const c = setup();
    expect(run(c).status).toBe(0);
    const text = readFileSync(c.config, 'utf8');
    expect(text).toContain(
      `[forwarding]\nenabled = true\nmode = "MODERN"\nsecret = "${SECRET}"\napprovedProxyHosts = []\n`,
    );
    expect(text.split(SECRET).length - 1).toBe(1);
    expect(text.indexOf(SECRET)).toBeLessThan(text.indexOf('[crossStitch]'));
    if (process.platform !== 'win32') expect(statSync(c.config).mode & 0o777).toBe(0o600);
  });

  it('a stale config with forwarding disabled exits 1, even though another section says enabled = true', () => {
    const c = setup();
    mkdirSync(join(c.data, 'config'), { recursive: true });
    writeFileSync(
      c.config,
      `[forwarding]\nenabled = false\nmode = "MODERN"\nsecret = "${SECRET}"\n\n[crossStitch]\nenabled = true\n`,
    );
    const r = run(c);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('does not enable MODERN forwarding with the current secret');
    expect(r.stdout).not.toContain('started');
    expectNoSecret(r);
  });

  it('a stale config whose secret line sits in another section exits 1', () => {
    const c = setup();
    mkdirSync(join(c.data, 'config'), { recursive: true });
    writeFileSync(
      c.config,
      `[forwarding]\nenabled = true\nmode = "MODERN"\n\n[other]\nsecret = "${SECRET}"\n`,
    );
    const r = run(c);
    expect(r.status).toBe(1);
    expectNoSecret(r);
  });

  it('a stale config with an old secret gets the secret replaced in place, then starts', () => {
    const c = setup();
    mkdirSync(join(c.data, 'config'), { recursive: true });
    writeFileSync(
      c.config,
      '[forwarding]\nenabled = true\nmode = "MODERN"\nsecret = "old-secret"\n\n[crossStitch]\nenabled = true\n',
    );
    const r = run(c);
    expect(r.status).toBe(0);
    const text = readFileSync(c.config, 'utf8');
    expect(text).toContain(`secret = "${SECRET}"`);
    expect(text).not.toContain('old-secret');
    expectNoSecret(r);
  });

  it('a secret outside [A-Za-z0-9_-] or empty exits 1 before any download', () => {
    for (const secret of ['bad secret!\n', '\n']) {
      const c = setup(secret);
      const r = run(c);
      expect(r.status).toBe(1);
      expect(curlCalls(c)).toBe(0);
    }
  });

  it('exec-s the start command with the arguments given to the entrypoint', () => {
    const c = setup();
    const r = run(c, {}, ['one', 'two']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('started one two');
  });

  it('the default pins in the script are the documented ones: sha512 of 128 hex digits, sha256 of 64', () => {
    const mod = ENTRY_TEXT.match(/MOD_SHA512=\$\{GELDAR_NF_MOD_SHA512:-([0-9a-f]+)\}/);
    const installer = ENTRY_TEXT.match(
      /INSTALLER_SHA256=\$\{GELDAR_NF_INSTALLER_SHA256:-([0-9a-f]+)\}/,
    );
    expect(mod?.[1]).toHaveLength(128);
    expect(mod?.[1].startsWith('dba5b70f')).toBe(true);
    expect(installer?.[1]).toHaveLength(64);
    expect(installer?.[1].startsWith('1184ffee')).toBe(true);
  });
});
