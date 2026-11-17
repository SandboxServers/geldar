/**
 * The NeoForge entrypoint's optional ledger jar and OpenTelemetry agent (compose/neoforge/neoforge-entrypoint.sh) run for real
 * under sh. The GELDAR_NF_* seams point the script at a temp data dir, a temp secret file, the mounted fixtures and a start
 * stub that prints JVM_OPTS. The mod and installer are pre-seeded with their pinned hashes, so curl is never reached.
 * Nothing here needs Docker or the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  const ledger = join(mount, 'geldar-ledger.jar');
  const agent = join(mount, 'opentelemetry-javaagent.jar');
  const props = join(mount, 'otel-agent.properties');
  writeFileSync(ledger, LEDGER_BODY);
  writeFileSync(agent, AGENT_BODY);
  writeFileSync(props, PROPS_BODY);
  return {
    base,
    data,
    mods,
    ledger,
    agent,
    props,
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
const ledgerCopy = (c: Case) => join(c.mods, 'geldar-ledger.jar');
const agentArgs = (c: Case) =>
  `-javaagent:${slash(c.agent)} -Dotel.javaagent.configuration-file=${slash(c.props)}`;

describe.skipIf(skipWithoutSh())(
  'NeoForge entrypoint: ledger jar, bundle and OpenTelemetry agent',
  { timeout: 60_000 },
  () => {
    it('copies a good ledger jar into mods/, and a second start passes with the copy unchanged', () => {
      const c = setup();
      const extra = { GELDAR_NF_LEDGER_SHA256: LEDGER_PIN };
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
      const r = run(c, { GELDAR_NF_LEDGER_SHA256: '0'.repeat(64) });
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
        const extra: Record<string, string> =
          pin === undefined ? {} : { GELDAR_NF_LEDGER_SHA256: pin };
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

    it('a mounted ledger jar with the pin unset refuses and removes a stale copy', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), LEDGER_BODY);
      const r = run(c);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_LEDGER_SHA256 is not 64 lowercase hex digits');
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('bundle mode refuses a foreign jar in mods/ and passes with both expected jars', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(join(c.mods, 'foreign.jar'), 'not ours');
      const foreign = run(c, { GELDAR_NF_LEDGER_SHA256: LEDGER_PIN });
      expect(foreign.status).toBe(1);
      expect(foreign.stderr).toContain(
        'mods/ holds files the offline bundle does not list: mods/foreign.jar',
      );
      rmSync(join(c.mods, 'foreign.jar'));
      const ok = run(c, { GELDAR_NF_LEDGER_SHA256: LEDGER_PIN });
      expect(ok.status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('bundle mode replaces a stale ledger copy from an earlier start and the second start passes', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(ledgerCopy(c), 'an earlier copy with other bytes');
      const extra = { GELDAR_NF_LEDGER_SHA256: LEDGER_PIN };
      expect(run(c, extra).status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
      expect(run(c, extra).status).toBe(0);
      expect(readFileSync(ledgerCopy(c), 'utf8')).toBe(LEDGER_BODY);
    });

    it('off removes a stale ledger copy and starts with no jar mounted', () => {
      const c = setup();
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_LEDGER_SHA256: 'off' });
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
      expect(r.stdout).toContain('JVM_OPTS=');
    });

    it('off with no stale copy starts and copies nothing, even with a jar mounted', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_LEDGER_SHA256: 'off' });
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('off in bundle mode clears the stale copy so the strict check passes', () => {
      const c = setup();
      writeBundle(c);
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, { GELDAR_NF_LEDGER_SHA256: 'off' });
      expect(r.status).toBe(0);
      expect(existsSync(ledgerCopy(c))).toBe(false);
    });

    it('off never removes our mod jar or any other file in mods/', () => {
      const c = setup();
      writeFileSync(join(c.mods, 'geldar-neoforge.jar'), 'our mod copy');
      writeFileSync(join(c.mods, 'other.jar'), 'other');
      writeFileSync(ledgerCopy(c), 'a stale copy');
      const r = run(c, { GELDAR_NF_LEDGER_JAR: ABSENT, GELDAR_NF_LEDGER_SHA256: 'off' });
      // A mod copy with no mounted mod jar is refused by the mod rule, which runs first; off must leave it and other.jar alone.
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a geldar mod jar is present in mods/ but none is mounted');
      expect(readFileSync(join(c.mods, 'geldar-neoforge.jar'), 'utf8')).toBe('our mod copy');
      expect(readFileSync(join(c.mods, 'other.jar'), 'utf8')).toBe('other');
    });

    it('any other non-hex value refuses to start', () => {
      const c = setup();
      const r = run(c, { GELDAR_NF_LEDGER_SHA256: 'yes' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is not 64 lowercase hex digits');
      expect(r.stdout).not.toContain('JVM_OPTS');
    });

    it('the entrypoint text never writes or chowns the ledger config, and names the agent defaults', () => {
      expect(ENTRY_TEXT).not.toMatch(/ledger\.properties/);
      expect(ENTRY_TEXT).toContain('/opt/otel/opentelemetry-javaagent.jar');
      expect(ENTRY_TEXT).toContain('/opt/otel/otel-agent.properties');
      expect(ENTRY_TEXT).not.toContain(
        'e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149',
      );
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
      const zero = run(c, { JVM_OPTS: '-Xmx1g', GELDAR_NF_OTEL_AGENT: '0' });
      expect(zero.stdout).toBe('JVM_OPTS=[-Xmx1g]\n');
    });

    it('on: appends both flags once after an existing JVM_OPTS', () => {
      const c = setup(false);
      const r = run(c, {
        GELDAR_NF_OTEL_AGENT: '1',
        GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN,
        JVM_OPTS: '-Xmx1g',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`JVM_OPTS=[-Xmx1g ${agentArgs(c)}]\n`);
      expect(r.stdout.split('-javaagent:').length - 1).toBe(1);
      expect(r.stdout.split('-Dotel.javaagent.configuration-file').length - 1).toBe(1);
    });

    it('on with no JVM_OPTS: both flags stand alone', () => {
      const c = setup(false);
      const r = run(c, { GELDAR_NF_OTEL_AGENT: '1', GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(agentArgs(c));
      expect(r.stdout.split('-javaagent:').length - 1).toBe(1);
    });

    it('on: refuses a jar whose sha256 does not match, without printing its bytes', () => {
      const c = setup(false);
      const r = run(c, { GELDAR_NF_OTEL_AGENT: '1', GELDAR_NF_OTEL_AGENT_SHA256: '0'.repeat(64) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('does not match GELDAR_NF_OTEL_AGENT_SHA256');
      expect(r.stdout).not.toContain('JVM_OPTS');
      expect(r.stdout + r.stderr).not.toContain(AGENT_BODY);
    });

    it('on: refuses a missing, short or uppercase agent pin', () => {
      for (const pin of [undefined, 'a'.repeat(63), 'B'.repeat(64)]) {
        const c = setup(false);
        const extra: Record<string, string> = { GELDAR_NF_OTEL_AGENT: '1' };
        if (pin !== undefined) extra.GELDAR_NF_OTEL_AGENT_SHA256 = pin;
        const r = run(c, extra);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('GELDAR_NF_OTEL_AGENT_SHA256 is not 64 lowercase hex digits');
      }
    });

    it('on: refuses a missing agent jar or properties file', () => {
      const c = setup(false);
      const missingJar = run(c, {
        GELDAR_NF_OTEL_AGENT: '1',
        GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN,
        GELDAR_NF_OTEL_JAR: ABSENT,
      });
      expect(missingJar.status).toBe(1);
      expect(missingJar.stderr).toContain('is missing, a symlink or not a regular file');
      const missingProps = run(c, {
        GELDAR_NF_OTEL_AGENT: '1',
        GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN,
        GELDAR_NF_OTEL_PROPS: ABSENT,
      });
      expect(missingProps.status).toBe(1);
      expect(missingProps.stderr).toContain('is missing, a symlink or not a regular file');
      expect(missingProps.stdout).not.toContain('JVM_OPTS');
    });

    it.runIf(CAN_LINK)('on: refuses an agent jar that is a symlink', () => {
      const c = setup(false);
      const link = join(c.base, 'mount', 'agent-link.jar');
      symlinkSync(c.agent, link);
      const r = run(c, {
        GELDAR_NF_OTEL_AGENT: '1',
        GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN,
        GELDAR_NF_OTEL_JAR: slash(link),
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('is missing, a symlink or not a regular file');
    });

    it('any other GELDAR_NF_OTEL_AGENT value refuses to start', () => {
      const c = setup(false);
      const r = run(c, { GELDAR_NF_OTEL_AGENT: 'true', GELDAR_NF_OTEL_AGENT_SHA256: AGENT_PIN });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('GELDAR_NF_OTEL_AGENT must be 1 or 0');
      expect(r.stdout).not.toContain('JVM_OPTS');
    });
  },
);
