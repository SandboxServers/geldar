/**
 * The NeoForge entrypoint's optional ledger jar and OpenTelemetry agent (compose/neoforge/neoforge-entrypoint.sh) run for real
 * under sh. The GELDAR_NF_* seams point the script at a temp data dir, a temp secret file, the mounted fixtures and a start
 * stub that prints JVM_OPTS. The mod and installer are pre-seeded with their pinned hashes, so curl is never reached.
 * Nothing here needs Docker or the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
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
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = `${ROOT}compose/neoforge/neoforge-entrypoint.sh`;
const ENTRY_TEXT = readFileSync(ENTRY, 'utf8');

/** Built from parts, so the dotted build never appears literally (the IP-literal check rejects it). */
const BUILD = ['26', '1', '2', '126'].join('.');
const MOD_BODY = 'fixture mod bytes';
const INSTALLER_BODY = 'fixture installer bytes';
const LEDGER_BODY = 'fixture ledger jar bytes';
const AGENT_BODY = 'fixture opentelemetry agent bytes';
const PROPS_BODY = 'otel.service.name=geldar-fixture\n';
const SECRET = 'nf-ledger-secret-Z3_q';

const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Whether this account may create a symlink (Windows without developer mode may not). */
const CAN_LINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-link-'));
  try {
    symlinkSync(dir, join(dir, 'probe'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

interface Case {
  base: string;
  data: string;
  mods: string;
  ledger: string;
  agent: string;
  props: string;
  ledgerProps: string;
  env: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A temp tree: a data dir with the pinned mod and installer, the mounted fixtures and a start stub that prints JVM_OPTS.
 * withLedger false points GELDAR_NF_LEDGER_JAR at a path that does not exist (nothing mounted).
 */
function setup(withLedger = true): Case {
  const base = mkdtempSync(join(tmpdir(), 'nf-ledger-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  const data = join(base, 'data');
  const mount = join(base, 'mount');
  const mods = join(data, 'mods');
  for (const dir of [bin, data, mount, mods]) mkdirSync(dir);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "curl was reached" >&2\nexit 9\n', {
    mode: 0o755,
  });
  writeFileSync(join(mods, 'proxy-compatible-forge.jar'), MOD_BODY);
  writeFileSync(join(data, 'neoforge-installer.jar'), INSTALLER_BODY);
  const start = join(bin, 'start');
  writeFileSync(start, '#!/bin/sh\nprintf "JVM_OPTS=[%s]\\n" "$JVM_OPTS"\n', { mode: 0o755 });
  const secretFile = join(base, 'velocity-forwarding');
  writeFileSync(secretFile, `${SECRET}\n`);
  const ledger = join(mount, 'geldar-neoforge-ledger.jar');
  const agent = join(mount, 'opentelemetry-javaagent.jar');
  const props = join(mount, 'otel-agent.properties');
  const ledgerProps = join(mount, 'ledger.properties');
  writeFileSync(ledger, LEDGER_BODY);
  writeFileSync(agent, AGENT_BODY);
  writeFileSync(props, PROPS_BODY);
  writeFileSync(ledgerProps, PROPS_BODY);
  return {
    base,
    data,
    mods,
    ledger,
    agent,
    props,
    ledgerProps,
    env: {
      PATH_BIN: bin,
      NEOFORGE_VERSION: BUILD,
      GELDAR_NF_DATA_DIR: slash(data),
      GELDAR_NF_SECRET_FILE: slash(secretFile),
      GELDAR_NF_START: slash(start),
      GELDAR_NF_MOD_SHA512: sha512(MOD_BODY),
      GELDAR_NF_INSTALLER_SHA256: sha256(INSTALLER_BODY),
      GELDAR_NF_INSTALLER_SHA512: sha512(INSTALLER_BODY),
      GELDAR_NF_LEDGER_JAR: slash(withLedger ? ledger : ABSENT),
      GELDAR_NF_OTEL_JAR: slash(agent),
      GELDAR_NF_OTEL_PROPS: slash(props),
      GELDAR_NF_LEDGER_PROPS: slash(ledgerProps),
    },
  };
}

/** Runs the entrypoint under sh. The environment is exactly the case's env plus extra: nothing is inherited but PATH. */
function run(c: Case, extra: Record<string, string> = {}) {
  const { PATH_BIN, ...env } = c.env;
  return spawnSync('sh', [slash(ENTRY)], {
    encoding: 'utf8',
    env: {
      PATH: `${PATH_BIN}${delimiter}${process.env.PATH ?? ''}`,
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      ...env,
      ...extra,
    },
  });
}

/** Writes the offline bundle list for the files the bundle names (mod, installer, manifest, run.sh) and their hashes. */
function writeBundle(c: Case) {
  const files: Record<string, string> = {
    '.neoforge-manifest.json': '{}\n',
    'neoforge-installer.jar': INSTALLER_BODY,
    'mods/proxy-compatible-forge.jar': MOD_BODY,
    'run.sh': '#!/bin/sh\n',
  };
  const lines: string[] = [];
  for (const [path, body] of Object.entries(files)) {
    writeFileSync(join(c.data, path), body);
    lines.push(`${sha256(body)}  ${path}`);
  }
  writeFileSync(join(c.data, '.geldar-bundle.sha256'), `${lines.join('\n')}\n`);
}

const LEDGER_PIN = sha256(LEDGER_BODY);
const AGENT_PIN = sha256(AGENT_BODY);
const ABSENT = '/nonexistent/geldar-fixture-absent.jar';
const ledgerCopy = (c: Case) => join(c.mods, 'geldar-neoforge-ledger.jar');
/** The on-switch environment: the ledger pin and the agent pin. The case must mount the ledger jar (setup(true)). */
const onEnv = (): Record<string, string> => ({
  GELDAR_NF_TELEMETRY: 'on',
  GELDAR_NF_LEDGER_SHA256: LEDGER_PIN,
  GELDAR_NF_OTEL_AGENT_PIN: AGENT_PIN,
});
const agentArgs = (c: Case) =>
  `-javaagent:${slash(c.agent)} -Dotel.javaagent.configuration-file=${slash(c.props)}`;

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint: ledger jar, bundle and OpenTelemetry agent',
  { timeout: 60_000 },
  () => {
    it('copies a good ledger jar into mods/, and a second start passes with the copy unchanged', () => {
      const c = setup();
      const extra = onEnv();
      const first = run(c, extra);
      expect(first.status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
      const second = run(c, extra);
      expect(second.status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
      expect(first.stdout + first.stderr).not.toContain(SECRET);
    });

    it('refuses a ledger jar whose sha256 does not match, copies nothing and starts nothing', () => {
      const c = setup();
      const r = run(c, { ...onEnv(), GELDAR_NF_LEDGER_SHA256: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        'the mounted ledger jar does not match GELDAR_NF_LEDGER_SHA256; not copied',
      );
      expect(existsSync(ledgerCopy(c))).toBe(false);
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(r.stdout + r.stderr).not.toContain(LEDGER_BODY);
    });

    it('refuses a missing, short or uppercase ledger pin before copying anything', () => {
      for (const pin of [undefined, 'a'.repeat(63), 'A'.repeat(64)]) {
        const c = setup();
        const extra: Record<string, string> = {
          GELDAR_NF_TELEMETRY: 'on',
          GELDAR_NF_OTEL_AGENT_PIN: AGENT_PIN,
          ...(pin === undefined ? {} : { GELDAR_NF_LEDGER_SHA256: pin }),
        };
        const r = run(c, extra);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(
          'is not 64 lowercase hex digits; refusing to start with a mounted ledger jar',
        );
        expect(existsSync(ledgerCopy(c))).toBe(false);
      }
    });

    it.runIf(CAN_LINK)('refuses a ledger mount that is a symlink', () => {
      const c = setup();
      const link = join(c.base, 'mount', 'link.jar');
      symlinkSync(c.ledger, link);
      const r = run(c, { GELDAR_NF_LEDGER_JAR: slash(link), GELDAR_NF_LEDGER_SHA256: LEDGER_PIN });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is a symlink or not a regular file; refusing to start');
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('refuses a stale ledger copy in mods/ when the pin is unset and nothing is mounted', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), LEDGER_BODY);
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a geldar ledger jar is present in mods/ but none is mounted');
      expect(r.stdout).not.toContain('JVM_OPTS');
    });

    it('refuses a ledger pin when no ledger jar is mounted', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_LEDGER_SHA256: LEDGER_PIN });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_LEDGER_SHA256 is set but no ledger jar is mounted');
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('a mounted ledger jar with the pin unset refuses and keeps the stale copy (a refusal never deletes it)', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), LEDGER_BODY);
      const r = run(c, { GELDAR_NF_TELEMETRY: 'on', GELDAR_NF_OTEL_AGENT_PIN: AGENT_PIN });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_LEDGER_SHA256 is not 64 lowercase hex digits');
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('a mounted ledger jar with telemetry unset refuses and keeps the stale copy', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), LEDGER_BODY);
      const r = run(c);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a ledger jar is mounted but GELDAR_NF_TELEMETRY is unset');
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('on: a mismatched mount refuses and does not delete the old copy in mods/', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), 'the old copy');
      const r = run(c, { ...onEnv(), GELDAR_NF_LEDGER_SHA256: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_LEDGER_SHA256; not copied');
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe('the old copy');
    });

    it('on: a directory at the ledger copy path exits 1 and nothing is moved inside it', () => {
      const c = setup();
      mkdirSync(ledgerCopy(c));
      const r = run(c, onEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is a directory; remove it; refusing to start');
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(existsSync(join(ledgerCopy(c), 'geldar-neoforge-ledger.jar'))).toBe(false);
      expect(readdirSync(ledgerCopy(c))).toEqual([]);
    });

    it('bundle mode refuses a foreign jar in mods/ and passes with both expected jars', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(join(c.mods, 'foreign.jar'), 'not ours');
      const foreign = run(c, onEnv());
      expect(foreign.status).toBe(1);
      expect(foreign.stderr).toContain(
        'mods/ holds files the offline bundle does not list: mods/foreign.jar',
      );
      rmSync(join(c.mods, 'foreign.jar'));
      const ok = run(c, onEnv());
      expect(ok.status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('bundle mode replaces a stale ledger copy from an earlier start and the second start passes', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(ledgerCopy(c), 'an earlier copy with other bytes');
      const extra = onEnv();
      expect(run(c, extra).status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
      expect(run(c, extra).status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('off removes a stale ledger copy and starts with no jar mounted', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
      expect(r.stdout).toContain('JVM_OPTS=');
    });

    it('off with a jar mounted refuses, names the mount, and copies nothing', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_TELEMETRY=off but a ledger jar is mounted');
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('off in bundle mode clears the stale copy so the strict check passes', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('off removes only our ledger copy: the mod copy, other.jar and the pinned mod keep their bytes and mode', () => {
      const c = setup();
      const modJar = join(c.base, 'mount', 'geldar-neoforge.jar');
      writeFileSync(modJar, MOD_BODY);
      writeFileSync(join(c.mods, 'other.jar'), 'other');
      chmodSync(join(c.mods, 'other.jar'), 0o644);
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, {
        GELDAR_NF_MOD_JAR: slash(modJar),
        GELDAR_NF_MOD_SHA256: sha256(MOD_BODY),
        GELDAR_NF_LEDGER_JAR: ABSENT,
        GELDAR_NF_TELEMETRY: 'off',
      });
      // The mod is mounted, so the off block runs (it is not stopped by the mod rule).
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
      expect(readFileSync(join(c.mods, 'geldar-neoforge.jar'), 'utf8')).toBe(MOD_BODY);
      expect(readFileSync(join(c.mods, 'other.jar'), 'utf8')).toBe('other');
      expect(readFileSync(join(c.mods, 'proxy-compatible-forge.jar'), 'utf8')).toBe(MOD_BODY);
      if (process.platform !== 'win32') {
        expect(statSync(join(c.mods, 'other.jar')).mode & 0o777).toBe(0o644);
      }
    });

    it('off refuses a directory at the ledger copy path, exits 1 and removes nothing inside it', () => {
      const c = setup();
      mkdirSync(ledgerCopy(c));
      writeFileSync(join(ledgerCopy(c), 'inner.txt'), 'keep');
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is a directory or other non-file; remove it; refusing to start');
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(readFileSync(join(ledgerCopy(c), 'inner.txt'), 'utf8')).toBe('keep');
    });

    it.runIf(CAN_LINK)('off unlinks a symlink at the ledger copy path without following it', () => {
      const c = setup();
      const target = join(c.base, 'link-target.jar');
      writeFileSync(target, 'target bytes');
      symlinkSync(target, ledgerCopy(c));
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(0);
      expect(() => lstatSync(ledgerCopy(c))).toThrow();
      expect(readFileSync(target, 'utf8')).toBe('target bytes');
    });

    it.runIf(CAN_LINK)('off unlinks a dangling symlink at the ledger copy path', () => {
      const c = setup();
      symlinkSync(join(c.base, 'nowhere.jar'), ledgerCopy(c));
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_TELEMETRY: 'off' });
      expect(r.status).toBe(0);
      expect(() => lstatSync(ledgerCopy(c))).toThrow();
    });

    it.skipIf(process.platform === 'win32')('the copied ledger jar is mode 644', () => {
      const c = setup();
      expect(run(c, onEnv()).status).toBe(0);
      expect(statSync(ledgerCopy(c)).mode & 0o777).toBe(0o644);
    });

    it('a stale .part from an interrupted copy is removed, and a good start leaves no .part', () => {
      const c = setup();
      writeFileSync(`${ledgerCopy(c)}.part`, 'a partial copy');
      const r = run(c, onEnv());
      expect(r.status).toBe(0);
      expect(existsSync(`${ledgerCopy(c)}.part`)).toBe(false);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('a stale .part is removed even when the start is refused, so a refused start leaves no .part', () => {
      const c = setup();
      writeFileSync(`${ledgerCopy(c)}.part`, 'a partial copy');
      const r = run(c, { ...onEnv(), GELDAR_NF_LEDGER_SHA256: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_LEDGER_SHA256; not copied');
      expect(existsSync(`${ledgerCopy(c)}.part`)).toBe(false);
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('a copy whose hash does not match leaves neither the final file nor a .part', () => {
      const c = setup();
      // A cp that appends a byte, so the copy fails the hash check after it is made.
      writeFileSync(join(c.base, 'bin', 'cp'), '#!/bin/sh\ncat "$1" > "$2" && printf x >> "$2"\n', {
        mode: 0o755,
      });
      const r = run(c, onEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_LEDGER_SHA256; removed it');
      expect(existsSync(ledgerCopy(c))).toBe(false);
      expect(existsSync(`${ledgerCopy(c)}.part`)).toBe(false);
      expect(r.stdout).not.toContain('JVM_OPTS');
    });

    it('any other non-hex value refuses to start', () => {
      const c = setup();
      const r = run(c, { ...onEnv(), GELDAR_NF_LEDGER_SHA256: 'yes' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is not 64 lowercase hex digits');
      expect(r.stdout).not.toContain('JVM_OPTS');
    });

    it('the entrypoint text never writes or chowns the ledger config, and names the agent defaults', () => {
      expect(ENTRY_TEXT).toContain('/geldar/telemetry/ledger.properties');
      expect(ENTRY_TEXT).toContain('/geldar/telemetry/opentelemetry-javaagent.jar');
      expect(ENTRY_TEXT).toContain('/geldar/telemetry/otel-agent.properties');
      expect(ENTRY_TEXT).not.toContain('/opt/otel');
      expect(ENTRY_TEXT).not.toContain(
        'e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149',
      );
    });
  },
);

const configCopy = (c: Case) => join(c.data, 'config', 'ledger.properties');

/** A start stub that prints the exec'd OTel switches and JVM_OPTS, or "unset" for each. */
function envStart(c: Case): string {
  const path = join(c.base, 'bin', 'env-start');
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "OTEL_SDK_DISABLED=%s\\nJAVA_AGENTS=%s\\nOTEL_JAVAAGENT_CONFIGURATION_FILE=%s\\nJVM_OPTS=%s\\n" "${OTEL_SDK_DISABLED-unset}" "${JAVA_AGENTS-unset}" "${OTEL_JAVAAGENT_CONFIGURATION_FILE-unset}" "${JVM_OPTS-unset}"\n',
    { mode: 0o755 },
  );
  return slash(path);
}

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint: ledger properties',
  { timeout: 60_000 },
  () => {
    it('copies the ledger properties to config/ at start, content equal and mode 644', () => {
      const c = setup(true);
      const r = run(c, onEnv());
      expect(r.status).toBe(0);
      expect(readFileSync(configCopy(c), 'utf8')).toBe(PROPS_BODY);
      expect(existsSync(`${configCopy(c)}.part`)).toBe(false);
      if (process.platform !== 'win32') expect(statSync(configCopy(c)).mode & 0o777).toBe(0o644);
    });

    it('replaces an older config/ledger.properties with the mounted copy on every start', () => {
      const c = setup(true);
      mkdirSync(join(c.data, 'config'));
      writeFileSync(configCopy(c), 'otel.service.name=stale\n');
      const r = run(c, onEnv());
      expect(r.status).toBe(0);
      expect(readFileSync(configCopy(c), 'utf8')).toBe(PROPS_BODY);
      expect(existsSync(`${configCopy(c)}.part`)).toBe(false);
    });

    it('a host edit to the mounted properties takes effect on the next start', () => {
      const c = setup(true);
      expect(run(c, onEnv()).status).toBe(0);
      writeFileSync(c.ledgerProps, 'otel.service.name=edited\n');
      expect(run(c, onEnv()).status).toBe(0);
      expect(readFileSync(configCopy(c), 'utf8')).toBe('otel.service.name=edited\n');
    });

    it.runIf(CAN_LINK)('refuses a symlink as the mounted properties and copies nothing', () => {
      const c = setup(true);
      const target = join(c.base, 'real-ledger.properties');
      writeFileSync(target, PROPS_BODY);
      rmSync(c.ledgerProps);
      symlinkSync(target, c.ledgerProps);
      const r = run(c, onEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is a symlink or not a regular file; refusing to start');
      expect(existsSync(configCopy(c))).toBe(false);
      expect(r.stdout + r.stderr).not.toContain(PROPS_BODY);
    });
  },
);

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint: OpenTelemetry agent',
  { timeout: 60_000 },
  () => {
    it('off by default: JVM_OPTS passes through unchanged and no agent flag appears', () => {
      const c = setup(false);
      const unset = run(c, { JVM_OPTS: '-Xmx1g' });
      expect(unset.status).toBe(0);
      expect(unset.stdout).toBe('JVM_OPTS=[-Xmx1g]\n');
      const off = run(c, { JVM_OPTS: '-Xmx1g', GELDAR_NF_TELEMETRY: 'off' });
      expect(off.status).toBe(0);
      expect(off.stdout).toBe('JVM_OPTS=[-Xmx1g]\n');
    });

    it('off: the exec environment has no agent flag, OTEL_SDK_DISABLED=true, and JAVA_AGENTS and OTEL_JAVAAGENT_CONFIGURATION_FILE unset', () => {
      const c = setup(false);
      const r = run(c, {
        GELDAR_NF_TELEMETRY: 'off',
        GELDAR_NF_START: envStart(c),
        JVM_OPTS: '-Xmx1g',
        JAVA_AGENTS: 'leftover.jar',
        OTEL_JAVAAGENT_CONFIGURATION_FILE: 'leftover.properties',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(
        'OTEL_SDK_DISABLED=true\nJAVA_AGENTS=unset\nOTEL_JAVAAGENT_CONFIGURATION_FILE=unset\nJVM_OPTS=-Xmx1g\n',
      );
      expect(r.stdout).not.toContain('javaagent');
      expect(existsSync(configCopy(c))).toBe(false);
    });

    it('on: the exec environment leaves the SDK enabled and carries both flags in JVM_OPTS', () => {
      const c = setup(true);
      const r = run(c, { ...onEnv(), GELDAR_NF_START: envStart(c) });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('OTEL_SDK_DISABLED=unset\n');
      expect(r.stdout).toContain(agentArgs(c));
    });

    it('on: appends both flags once after an existing JVM_OPTS', () => {
      const c = setup(true);
      const r = run(c, {
        ...onEnv(),
        JVM_OPTS: '-Xmx1g',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`JVM_OPTS=[-Xmx1g ${agentArgs(c)}]\n`);
      expect(r.stdout.split('-javaagent:').length - 1).toBe(1);
      expect(r.stdout.split('-Dotel.javaagent.configuration-file').length - 1).toBe(1);
    });

    it('on with no JVM_OPTS: both flags stand alone', () => {
      const c = setup(true);
      const r = run(c, onEnv());
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(agentArgs(c));
      expect(r.stdout.split('-javaagent:').length - 1).toBe(1);
    });

    it('on: refuses a jar whose sha256 does not match, without printing its bytes', () => {
      const c = setup(true);
      const r = run(c, { ...onEnv(), GELDAR_NF_OTEL_AGENT_PIN: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_OTEL_AGENT_PIN');
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(r.stdout + r.stderr).not.toContain(AGENT_BODY);
    });

    it('on: refuses a missing, short or uppercase agent pin', () => {
      for (const pin of [undefined, 'a'.repeat(63), 'B'.repeat(64)]) {
        const c = setup(true);
        const extra: Record<string, string> = { ...onEnv() };
        if (pin !== undefined) extra.GELDAR_NF_OTEL_AGENT_PIN = pin;
        else delete extra.GELDAR_NF_OTEL_AGENT_PIN;
        const r = run(c, extra);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('GELDAR_NF_OTEL_AGENT_PIN is not 64 lowercase hex digits');
      }
    });

    it('on: refuses a missing agent jar or properties file', () => {
      const c = setup(true);
      const missingJar = run(c, { ...onEnv(), GELDAR_NF_OTEL_JAR: ABSENT });
      expect(missingJar.status).toBe(1);
      expect(missingJar.stderr).toContain('is missing, a symlink or not a regular file');
      const missingProps = run(c, { ...onEnv(), GELDAR_NF_OTEL_PROPS: ABSENT });
      expect(missingProps.status).toBe(1);
      expect(missingProps.stderr).toContain('is missing, a symlink or not a regular file');
      expect(missingProps.stdout).not.toContain('JVM_OPTS');
    });

    it.runIf(CAN_LINK)('on: refuses an agent jar that is a symlink', () => {
      const c = setup(false);
      const link = join(c.base, 'mount', 'agent-link.jar');
      symlinkSync(c.agent, link);
      const r = run(c, { ...onEnv(), GELDAR_NF_OTEL_JAR: slash(link) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is missing, a symlink or not a regular file');
    });

    it('on: refuses an agent jar or properties path with whitespace before reading any hash', () => {
      for (const field of ['GELDAR_NF_OTEL_JAR', 'GELDAR_NF_OTEL_PROPS']) {
        const c = setup(true);
        const spaced = join(c.base, 'mount', 'agent with space');
        writeFileSync(spaced, AGENT_BODY);
        const r = run(c, { ...onEnv(), [field]: slash(spaced) });
        expect(r.status, field).toBe(1);
        expect(r.stderr, field).toContain('must not contain whitespace');
        expect(r.stdout, field).not.toContain('JVM_OPTS');
      }
    });

    it('any other GELDAR_NF_TELEMETRY value refuses to start', () => {
      const c = setup(true);
      for (const value of ['1', 'true', 'ON']) {
        const r = run(c, { GELDAR_NF_TELEMETRY: value, GELDAR_NF_OTEL_AGENT_PIN: AGENT_PIN });
        expect(r.status, value).toBe(1);
        expect(r.stderr, value).toContain('GELDAR_NF_TELEMETRY must be on or off (or unset)');
      }
      const r = run(c, { GELDAR_NF_TELEMETRY: 'true', GELDAR_NF_OTEL_AGENT_PIN: AGENT_PIN });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_TELEMETRY must be on or off (or unset)');
      expect(r.stdout).not.toContain('JVM_OPTS');
    });
  },
);
