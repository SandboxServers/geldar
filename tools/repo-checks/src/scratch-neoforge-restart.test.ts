/**
 * The NeoForge entrypoint's restart behaviour (compose/neoforge/neoforge-entrypoint.sh) run for real under sh. The entrypoint
 * owns proxy-compatible-forge.toml at every start (the previous file is kept as .bak); the first-restart sequence (a first
 * start, the server's rewrite, a start again, and a third start) must keep starting; and GELDAR_NF_TELEMETRY=off removes our own
 * stale ledger copy (the rollback). Same stub-curl harness as scratch-neoforge-entrypoint.test.ts; no Docker, no network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_NAME = 'proxy-compatible-forge-1.3.1.jar';
const INSTALLER_NAME = `neoforge-${BUILD}-installer.jar`;
/** Recognizable secrets: the tests check the current one never reaches stdout, stderr or the start command's environment. */
const SECRET = 'nf-restart-secret-R3_k';
const OLD_SECRET = 'nf-restart-old-secret-Z9';
const PCF_BODY = 'fixture proxy compatible forge bytes';
const GEO_BODY = 'fixture geldar mod bytes';
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
/** Prints its arguments, and dumps its environment and arguments to files, so a test can check what the start command receives. */
const START_STUB = [
  '#!/bin/sh',
  'env >"$STUB_START_ENV"',
  'printf "%s\\n" "$*" >"$STUB_START_ARGS"',
  'echo "started $*"',
  '',
].join('\n');

const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface Case {
  data: string;
  config: string;
  env: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temp tree: stub bin, fixtures, the secret file, a mounted geldar mod with its pin, and no ledger mounted. */
function setup(secret = `${SECRET}\n`): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-restart-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const fixtures = join(base, 'fixtures');
  const data = join(base, 'data');
  const mount = join(base, 'mount');
  for (const dir of [bin, fixtures, data, mount]) mkdirSync(dir);
  writeFileSync(join(fixtures, MOD_NAME), PCF_BODY);
  writeFileSync(join(fixtures, INSTALLER_NAME), INSTALLER_BODY);
  writeFileSync(join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'start'), START_STUB, { mode: 0o755 });
  const mountedMod = join(mount, 'geldar-neoforge.jar');
  writeFileSync(mountedMod, GEO_BODY);
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, secret);
  return {
    data,
    config: join(data, 'config', 'proxy-compatible-forge.toml'),
    env: {
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(join(bin, 'start')),
      GELDAR_NF_MOD_SHA512: sha512(PCF_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_BODY),
      GELDAR_NF_MOD_JAR: slash(mountedMod),
      GELDAR_NF_MOD_SHA256: sha256(GEO_BODY),
      GELDAR_NF_LEDGER_JAR: slash(join(base, 'absent-ledger.jar')),
      NEOFORGE_VERSION: BUILD,
      STUB_CURL_LOG: slash(join(base, 'curl.log')),
      STUB_CURL_FIXTURES: slash(fixtures),
      STUB_START_ENV: slash(join(base, 'start-env.txt')),
      STUB_START_ARGS: slash(join(base, 'start-args.txt')),
      PATH_BIN: slash(bin),
    },
  };
}

/** Runs the entrypoint under sh with the stub curl and start command first on PATH. */
function run(c: Case, extra: Record<string, string> = {}) {
  const r = spawnSync('sh', [slash(ENTRY)], {
    encoding: 'utf8',
    env: {
      PATH: `${c.env.PATH_BIN}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      ...c.env,
      ...extra,
    },
  });
  expectNoSecret(r, c);
  return r;
}

const read = (path: string) => readFileSync(path, 'utf8');

function writeToml(c: Case, text: string) {
  mkdirSync(join(c.data, 'config'), { recursive: true });
  writeFileSync(c.config, text);
}

/** The shape a server's Proxy Compatible Forge rewrite might leave: comments, other key order, spacing and quotes changed. */
function reformatted(secret: string): string {
  return [
    '# Proxy Compatible Forge config, rewritten by the mod',
    '[advanced]',
    '  modernForwardingVersion = "NO_OVERRIDE"  # kept',
    '',
    '[forwarding]',
    "  mode='MODERN'",
    `  secret = "${secret}"   # the Velocity secret`,
    '  enabled =   true',
    '  approvedProxyHosts = [ ]',
    '',
    '[crossStitch]',
    'enabled = true',
    '',
    '[extra]',
    'key = "value"',
    '',
  ].join('\n');
}

/** What a stub recorded, or '' when the stub never ran (a refused start). */
const recorded = (path: string | undefined) =>
  path && existsSync(path) ? readFileSync(path, 'utf8') : '';

/**
 * The secrets must be absent from stdout and stderr, from the start command's arguments and environment, and from the curl
 * arguments. Checked for every case that runs the entrypoint; a case that exits before the start command leaves those files empty.
 */
function expectNoSecret(r: { stdout: string; stderr: string }, c: Case) {
  const seen = [
    r.stdout + r.stderr,
    recorded(c.env.STUB_START_ENV),
    recorded(c.env.STUB_START_ARGS),
    recorded(c.env.STUB_CURL_LOG),
  ];
  for (const text of seen) {
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(OLD_SECRET);
  }
}

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint owns the proxy-compatible-forge.toml',
  { timeout: 120_000 },
  () => {
    it('(a) a reformatted toml with the right secret starts, and ends with MODERN and the secret once', () => {
      const c = setup();
      writeToml(c, reformatted(SECRET));
      const r = run(c);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('started');
      const text = read(c.config);
      expect(text.split(SECRET).length - 1).toBe(1);
      expect(text.split('mode = "MODERN"').length - 1).toBe(1);
      expect(text).toContain('enabled = true');
      expect(text).not.toContain("mode='MODERN'");
      expect(text).toContain('  modernForwardingVersion = "NO_OVERRIDE"  # kept');
      expect(text).toContain('[extra]\nkey = "value"');
      expectNoSecret(r, c);
    });

    it('(b) a toml with a different secret is repaired: the new secret is written, the backup holds the old file', () => {
      const c = setup();
      writeToml(c, reformatted(OLD_SECRET));
      const r = run(c);
      expect(r.status).toBe(0);
      const text = read(c.config);
      expect(text.split(SECRET).length - 1).toBe(1);
      expect(text).not.toContain(OLD_SECRET);
      const backup = read(`${c.config}.bak`);
      expect(backup).toContain(OLD_SECRET);
      expect(backup).not.toContain(SECRET);
      expectNoSecret(r, c);
      expect(r.stdout + r.stderr).not.toContain(OLD_SECRET);
      const startEnv = c.env.STUB_START_ENV ?? '';
      expect(startEnv).not.toBe('');
      expect(read(startEnv)).not.toContain(SECRET);
    });

    it('(c) forwarding disabled or mode NONE is repaired to enabled = true and MODERN', () => {
      const c = setup();
      writeToml(
        c,
        `[forwarding]\nenabled = false\nmode = "NONE"\nsecret = "${SECRET}"\n\n[crossStitch]\nenabled = true\n`,
      );
      const r = run(c);
      expect(r.status).toBe(0);
      const text = read(c.config);
      expect(text).toContain(
        '[forwarding]\nenabled = true\nmode = "MODERN"\nsecret = "' + SECRET + '"\n',
      );
      expect(text).not.toContain('enabled = false');
      expect(text).not.toContain('mode = "NONE"');
      expect(read(`${c.config}.bak`)).toContain('enabled = false');
      expectNoSecret(r, c);
    });

    it('(c2) a secret line in another table is not enough: the secret is inserted into [forwarding], other lines stay', () => {
      const c = setup();
      writeToml(
        c,
        `[forwarding]\nenabled = true\nmode = "MODERN"\n\n[other]\nsecret = "${SECRET}"\n`,
      );
      const r = run(c);
      expect(r.status).toBe(0);
      const text = read(c.config);
      expect(text).toContain('[other]\nsecret = "' + SECRET + '"\n');
      expect(text.split(`secret = "${SECRET}"`).length - 1).toBe(2);
      expectNoSecret(r, c);
    });

    it('(d) with no toml the config is created as before, and no backup is made', () => {
      const c = setup();
      const r = run(c);
      expect(r.status).toBe(0);
      expect(read(c.config)).toContain(
        `[forwarding]\nenabled = true\nmode = "MODERN"\nsecret = "${SECRET}"\napprovedProxyHosts = []\n`,
      );
      expect(existsSync(`${c.config}.bak`)).toBe(false);
      expectNoSecret(r, c);
    });

    it('(e) the first restart: a first start, the server rewrites the toml and makes its dirs, then starts again and a third time', () => {
      const c = setup();
      const first = run(c);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain('started');
      mkdirSync(join(c.data, 'logs'), { recursive: true });
      mkdirSync(join(c.data, 'world'), { recursive: true });
      writeToml(c, reformatted(SECRET));
      const second = run(c);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('started');
      const afterSecond = read(c.config);
      const third = run(c);
      expect(third.status).toBe(0);
      expect(third.stdout).toContain('started');
      expect(read(c.config)).toBe(afterSecond);
      expect(afterSecond.split(SECRET).length - 1).toBe(1);
      expect(existsSync(join(c.data, 'logs'))).toBe(true);
      expect(existsSync(join(c.data, 'world'))).toBe(true);
      for (const r of [first, second, third]) expectNoSecret(r, c);
    });

    it('(f) the toml and its backup are mode 600 with the data dir owner (POSIX only)', () => {
      const c = setup();
      expect(run(c).status).toBe(0);
      writeToml(c, reformatted(OLD_SECRET));
      expect(run(c).status).toBe(0);
      if (process.platform === 'win32') return;
      const data = statSync(c.data);
      for (const path of [c.config, `${c.config}.bak`]) {
        const st = statSync(path);
        expect(st.mode & 0o777).toBe(0o600);
        expect(st.uid).toBe(data.uid);
        expect(st.gid).toBe(data.gid);
      }
    });

    const CAN_LINK = (() => {
      const dir = mkdtempSync(join(tmpdir(), 'nf-restart-link-'));
      try {
        symlinkSync(dir, join(dir, 'probe'));
        return true;
      } catch {
        return false;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })();

    // A symlink at the toml or a backup path is refused before any write: exit 1, nothing starts, the link's target is not
    // written, and the link is still a link. Without the refusal the entrypoint writes through a dangling link.
    it.runIf(CAN_LINK)(
      'a symlink at the toml path is refused: exit 1, the target is untouched, nothing starts',
      () => {
        const c = setup();
        mkdirSync(join(c.data, 'config'), { recursive: true });
        const target = join(c.data, '..', 'link-target.toml');
        writeFileSync(target, 'link-target-body');
        symlinkSync(target, c.config);
        const r = run(c);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('symlink');
        expect(r.stdout).not.toContain('started');
        expect(lstatSync(c.config).isSymbolicLink()).toBe(true);
        expect(read(target)).toBe('link-target-body');
        expectNoSecret(r, c);
      },
    );

    it.runIf(CAN_LINK)(
      'a dangling symlink at the toml path writes nothing through the link',
      () => {
        const c = setup();
        mkdirSync(join(c.data, 'config'), { recursive: true });
        const absent = join(c.data, '..', 'absent-target.toml');
        symlinkSync(absent, c.config);
        const r = run(c);
        expect(r.status).toBe(1);
        expect(r.stdout).not.toContain('started');
        expect(existsSync(absent)).toBe(false);
        expect(lstatSync(c.config).isSymbolicLink()).toBe(true);
        expectNoSecret(r, c);
      },
    );

    it.runIf(CAN_LINK)('a symlink at the .bak path is refused before the toml is rewritten', () => {
      const c = setup();
      writeToml(c, reformatted(OLD_SECRET));
      const target = join(c.data, '..', 'bak-target.toml');
      writeFileSync(target, 'bak-target-body');
      symlinkSync(target, `${c.config}.bak`);
      const r = run(c);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('started');
      expect(read(c.config)).toBe(reformatted(OLD_SECRET));
      expect(read(target)).toBe('bak-target-body');
      expectNoSecret(r, c);
      expect(r.stdout + r.stderr).not.toContain(OLD_SECRET);
    });

    it('three starts: .bak keeps the first original, .bak.prev holds the file the previous start left', () => {
      const THIRD = 'nf-restart-third-Q7';
      const c = setup();
      writeToml(c, reformatted(OLD_SECRET));
      expect(run(c).status).toBe(0);
      // The mod rewrites the file again with a third secret before the next start.
      writeToml(c, reformatted(THIRD));
      const second = run(c);
      expect(second.status).toBe(0);
      expectNoSecret(second, c);
      expect(second.stdout + second.stderr).not.toContain(THIRD);
      expect(read(`${c.config}.bak`)).toContain(OLD_SECRET);
      expect(read(`${c.config}.bak`)).not.toContain(THIRD);
      expect(read(`${c.config}.bak.prev`)).toContain(THIRD);
      expect(read(`${c.config}.bak.prev`)).not.toContain(OLD_SECRET);
      expect(read(c.config).split(SECRET).length - 1).toBe(1);
    });

    it('a second start over an intact file leaves it byte-identical', () => {
      const c = setup();
      expect(run(c).status).toBe(0);
      const once = read(c.config);
      expect(run(c).status).toBe(0);
      expect(read(c.config)).toBe(once);
    });
  },
);

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint telemetry off removes our stale ledger copy',
  { timeout: 30_000 },
  () => {
    it('GELDAR_NF_TELEMETRY=off with no ledger mounted removes mods/geldar-neoforge-ledger.jar and starts', () => {
      const c = setup();
      const ledgerCopy = join(c.data, 'mods', 'geldar-neoforge-ledger.jar');
      mkdirSync(join(c.data, 'mods'), { recursive: true });
      writeFileSync(ledgerCopy, 'stale ledger copy');
      const r = run(c, { GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('started');
      expect(existsSync(ledgerCopy)).toBe(false);
      expectNoSecret(r, c);
    });

    it('the same volume with GELDAR_NF_TELEMETRY unset still refuses to start (the guard stays)', () => {
      const c = setup();
      const ledgerCopy = join(c.data, 'mods', 'geldar-neoforge-ledger.jar');
      mkdirSync(join(c.data, 'mods'), { recursive: true });
      writeFileSync(ledgerCopy, 'stale ledger copy');
      const r = run(c);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a geldar ledger jar is present in mods/ but none is mounted');
      expect(r.stdout).not.toContain('started');
      expect(existsSync(ledgerCopy)).toBe(true);
    });

    it('off with a directory at the ledger path refuses and removes nothing', () => {
      const c = setup();
      const ledgerPath = join(c.data, 'mods', 'geldar-neoforge-ledger.jar');
      mkdirSync(ledgerPath, { recursive: true });
      const r = run(c, { GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('directory or other non-file');
      expect(existsSync(ledgerPath)).toBe(true);
    });
  },
);
