/**
 * The NeoForge ledger jar and OpenTelemetry agent on the scratch shard: the variables in deploy/scratch/scratch-ledger.sh
 * (run under sh with the stub harness, so nothing starts), and the overlay compose/opt-in/scratch-neoforge-ledger.yml (parsed).
 * Nothing here starts a container: every docker call is recorded by the stub.
 */
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  AUTH,
  type Env,
  JARS,
  LEDGER_SCRIPT,
  type RunOpts,
  runScript,
  skipWithoutSh,
  slash,
} from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge-ledger.yml`, 'utf8');
const NF_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge.yml`, 'utf8');
const OFF_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge-ledger-off.yml`, 'utf8');
const DOC_TEXT = readFileSync(`${ROOT}docs/analysis/telemetry/nf-live-telemetry.md`, 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Fixture bytes for the four host files. The tests check the bytes never reach stdout or stderr. */
const LEDGER = 'ledger jar fixture bytes';
const LEDGER_SHA = sha256(LEDGER);
const AGENT = 'agent jar fixture bytes';
const AGENT_SHA = sha256(AGENT);
const PROPS = 'ledger.config.fixture=1\n';

/** The real agent pin (scratch-ledger.sh and the overlay). The fixture agent jar cannot match it, so the success runs use a
 * copy of the script whose pin is AGENT_SHA: the same check, a different constant. The refusal runs use the real pin. */
const AGENT_TREE: RunOpts = { tree: { jars: true, agentPin: AGENT_SHA } };

/** Writes the four files into the stub base dir and returns their paths (forward slashes). */
function files(base: string) {
  const paths = {
    jar: join(base, 'ledger.jar'),
    props: join(base, 'ledger.properties'),
    agentJar: join(base, 'agent.jar'),
    agentProps: join(base, 'agent.properties'),
  };
  writeFileSync(paths.jar, LEDGER);
  writeFileSync(paths.props, PROPS);
  writeFileSync(paths.agentJar, AGENT);
  writeFileSync(paths.agentProps, 'otel.fixture=1\n');
  return paths;
}

/** The ledger pair and props as the environment; the agent pair and properties too only when agent is true. */
function ledgerEnv(sha: string | undefined, opts: { agent?: boolean; extra?: Env } = {}) {
  return (base: string): Env => {
    const f = files(base);
    const env: Env = {
      ...AUTH,
      SCRATCH_PLATFORM: 'neoforge',
      SCRATCH_NEOFORGE_LEDGER_JAR: slash(f.jar),
      SCRATCH_NEOFORGE_LEDGER_SHA256: sha,
      SCRATCH_LEDGER_PROPS: slash(f.props),
      ...opts.extra,
    };
    if (sha === 'off') env.SCRATCH_NEOFORGE_TELEMETRY = 'off';
    if (opts.agent) {
      env.SCRATCH_NEOFORGE_OTEL_AGENT_JAR = slash(f.agentJar);
      env.SCRATCH_NEOFORGE_OTEL_AGENT_PROPS = slash(f.agentProps);
    }
    return env;
  };
}

const upLine = (calls: string[]) => calls.find((c) => c.includes(' up -d')) ?? '';
/** The refusal the script prints when fewer or more than the five ledger variables are set (or the trio is partial). */
const FIVE = 'set all five of SCRATCH_NEOFORGE_LEDGER_JAR, SCRATCH_NEOFORGE_LEDGER_SHA256';

describe.skipIf(skipWithoutSh())(
  'scratch.sh: the ledger jar variables (up refuses, nothing starts)',
  { timeout: 60_000 },
  () => {
    it('the jar without its hash, or the hash without the jar, exits 2 before any docker call', () => {
      const onlyJar = runScript(
        ['up'],
        (base) => ({ ...ledgerEnv(undefined)(base), SCRATCH_NEOFORGE_LEDGER_SHA256: undefined }),
        JARS,
      );
      expect(onlyJar.status).toBe(2);
      expect(onlyJar.stderr).toContain(FIVE);
      expect(onlyJar.calls).toEqual([]);

      const onlySha = runScript(
        ['up'],
        (base) => ({ ...ledgerEnv(LEDGER_SHA)(base), SCRATCH_NEOFORGE_LEDGER_JAR: undefined }),
        JARS,
      );
      expect(onlySha.status).toBe(2);
      expect(onlySha.stderr).toContain(FIVE);
      expect(onlySha.calls).toEqual([]);
    });

    it('paper with the ledger variables exits 2 before any docker call; down and status still run', () => {
      const up = runScript(
        ['up'],
        ledgerEnv(LEDGER_SHA, { agent: true, extra: { SCRATCH_PLATFORM: 'paper' } }),
        AGENT_TREE,
      );
      expect(up.status).toBe(2);
      expect(up.stderr).toContain('need SCRATCH_PLATFORM=neoforge');
      expect(up.calls).toEqual([]);
      for (const verb of ['down', 'status']) {
        const r = runScript(
          [verb],
          ledgerEnv(LEDGER_SHA, { extra: { SCRATCH_PLATFORM: 'paper' } }),
          JARS,
        );
        expect(r.status, verb).toBe(0);
        expect(r.calls.join('\n'), verb).not.toContain('scratch-neoforge-ledger.yml');
      }
    });

    it('the Paper telemetry variable SCRATCH_OTEL_AGENT_JAR does not trigger the ledger code: up on telemetry runs with no ledger refusal or overlay', () => {
      const r = runScript(
        ['up', 'telemetry'],
        (base) => {
          const telemetryAgent = join(base, 'telemetry-agent.jar');
          writeFileSync(telemetryAgent, AGENT);
          return { ...AUTH, SCRATCH_OTEL_AGENT_JAR: slash(telemetryAgent) };
        },
        JARS,
      );
      expect(r.stderr).not.toContain('need SCRATCH_PLATFORM=neoforge');
      expect(r.stderr).not.toContain('SCRATCH_NEOFORGE_OTEL_AGENT');
      expect(r.calls.join('\n')).not.toContain('scratch-neoforge-ledger');
      expect(upLine(r.calls)).toContain(' up -d');
    });

    it('an agent path with whitespace exits 2 before any docker call, for the jar and for the properties file', () => {
      for (const field of [
        'SCRATCH_NEOFORGE_OTEL_AGENT_JAR',
        'SCRATCH_NEOFORGE_OTEL_AGENT_PROPS',
      ]) {
        const r = runScript(
          ['up'],
          (base) => {
            const spaced = join(base, 'agent with space.jar');
            writeFileSync(spaced, AGENT);
            return {
              ...ledgerEnv(LEDGER_SHA)(base),
              SCRATCH_NEOFORGE_OTEL_AGENT_JAR: slash(join(base, 'agent.jar')),
              SCRATCH_NEOFORGE_OTEL_AGENT_PROPS: slash(join(base, 'agent.properties')),
              [field]: slash(spaced),
            };
          },
          JARS,
        );
        expect(r.status, field).toBe(2);
        expect(r.stderr, field).toContain(`${field} must not contain whitespace`);
        expect(r.calls, field).toEqual([]);
      }
    });

    it('a relative path, a path with quotes, or a non-hex hash exits 2 before any docker call', () => {
      const relative = runScript(
        ['up'],
        (base) => ({
          ...ledgerEnv(LEDGER_SHA, { agent: true })(base),
          SCRATCH_NEOFORGE_LEDGER_JAR: 'ledger/x.jar',
        }),
        JARS,
      );
      expect(relative.status).toBe(2);
      expect(relative.stderr).toContain('must be an absolute path');
      expect(relative.calls).toEqual([]);

      const quoted = runScript(
        ['up'],
        ledgerEnv(LEDGER_SHA, {
          agent: true,
          extra: { SCRATCH_LEDGER_PROPS: '/x/a"b.properties' },
        }),
        JARS,
      );
      expect(quoted.status).toBe(2);
      expect(quoted.stderr).toContain('must be an absolute path');
      expect(quoted.calls).toEqual([]);

      for (const bad of [
        LEDGER_SHA.toUpperCase(),
        LEDGER_SHA.slice(1),
        `${LEDGER_SHA}0`,
        `${LEDGER_SHA.slice(0, 63)}\n`,
      ]) {
        const r = runScript(['up'], ledgerEnv(bad, { agent: true }), JARS);
        expect(r.status, JSON.stringify(bad)).toBe(2);
        expect(r.stderr).toContain('64 lowercase hex digits');
        expect(r.calls).toEqual([]);
      }
    });

    it('a jar whose host sha256 differs from the pin exits 2, starts nothing and prints no jar bytes', () => {
      const r = runScript(['up'], ledgerEnv('0'.repeat(64), { agent: true }), JARS);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('does not match SCRATCH_NEOFORGE_LEDGER_SHA256');
      expect(r.calls).toEqual([]);
      expect(r.stdout + r.stderr).not.toContain(LEDGER);
    });

    it('an agent jar whose sha256 differs from the real agent pin exits 2, starts nothing and prints no agent bytes', () => {
      const r = runScript(['up'], ledgerEnv(LEDGER_SHA, { agent: true }), JARS);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('SCRATCH_NEOFORGE_OTEL_AGENT_JAR does not match the agent pin');
      expect(r.calls).toEqual([]);
      expect(r.stdout + r.stderr).not.toContain(AGENT);
    });

    it('an agent trio with a missing member, or with the jar pair absent, exits 2 before any docker call', () => {
      const partial = runScript(
        ['up'],
        (base) => ({
          ...ledgerEnv(LEDGER_SHA)(base),
          SCRATCH_NEOFORGE_OTEL_AGENT_JAR: slash(join(base, 'agent.jar')),
        }),
        JARS,
      );
      expect(partial.status).toBe(2);
      expect(partial.stderr).toContain(FIVE);
      expect(partial.calls).toEqual([]);

      const noPair = runScript(
        ['up'],
        (base) => ({
          ...AUTH,
          SCRATCH_PLATFORM: 'neoforge',
          SCRATCH_LEDGER_PROPS: slash(files(base).props),
        }),
        JARS,
      );
      expect(noPair.status).toBe(2);
      expect(noPair.stderr).toContain(FIVE);
      expect(noPair.calls).toEqual([]);
    });

    it('the jar pair and props without the agent trio exits 2 before any docker call: the render is all five or none', () => {
      const r = runScript(['up'], ledgerEnv(LEDGER_SHA), JARS);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(FIVE);
      expect(r.calls).toEqual([]);
    });

    it('all five variables with matching hashes: up adds the one ledger overlay after scratch-neoforge.yml and before nats-override.yml', () => {
      const r = runScript(['up'], ledgerEnv(LEDGER_SHA, { agent: true }), AGENT_TREE);
      expect(r.status).toBe(0);
      const up = upLine(r.calls);
      expect(up.split('scratch-neoforge-ledger.yml').length - 1).toBe(1);
      expect(up.indexOf('opt-in/scratch-neoforge.yml')).toBeLessThan(
        up.indexOf('opt-in/scratch-neoforge-ledger.yml'),
      );
      expect(up.indexOf('opt-in/scratch-neoforge-ledger.yml')).toBeLessThan(
        up.indexOf('nats-override.yml'),
      );
    });

    it('the soft kill: SCRATCH_NEOFORGE_TELEMETRY=off alone exits 0 and adds the off overlay, never the jar overlay', () => {
      const r = runScript(
        ['up'],
        { ...AUTH, SCRATCH_PLATFORM: 'neoforge', SCRATCH_NEOFORGE_TELEMETRY: 'off' },
        JARS,
      );
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain('scratch:');
      const up = upLine(r.calls);
      expect(up.indexOf('opt-in/scratch-neoforge.yml')).toBeLessThan(
        up.indexOf('opt-in/scratch-neoforge-ledger-off.yml'),
      );
      expect(up.indexOf('opt-in/scratch-neoforge-ledger-off.yml')).toBeLessThan(
        up.indexOf('nats-override.yml'),
      );
      expect(up).not.toContain('scratch-neoforge-ledger.yml');
    });

    it('off with a jar path or an agent variable exits 2 before any docker call: the two are contradictory', () => {
      const withJar = runScript(['up'], ledgerEnv('off'), JARS);
      expect(withJar.status).toBe(2);
      expect(withJar.stderr).toContain('contradictory');
      expect(withJar.stderr).toContain('nothing started');
      expect(withJar.calls).toEqual([]);

      const withAgent = runScript(['up'], ledgerEnv('off', { agent: true }), JARS);
      expect(withAgent.status).toBe(2);
      expect(withAgent.stderr).toContain('contradictory');
      expect(withAgent.calls).toEqual([]);
      expect(withAgent.stdout + withAgent.stderr).not.toContain(LEDGER);
    });

    it('off with any one of the five ledger variables, alone with off, exits 2 before any docker call', () => {
      for (const name of [
        'SCRATCH_NEOFORGE_LEDGER_JAR',
        'SCRATCH_NEOFORGE_LEDGER_SHA256',
        'SCRATCH_LEDGER_PROPS',
        'SCRATCH_NEOFORGE_OTEL_AGENT_JAR',
        'SCRATCH_NEOFORGE_OTEL_AGENT_PROPS',
      ]) {
        const r = runScript(
          ['up'],
          { ...AUTH, SCRATCH_PLATFORM: 'neoforge', SCRATCH_NEOFORGE_TELEMETRY: 'off', [name]: 'x' },
          JARS,
        );
        expect(r.status, name).toBe(2);
        expect(r.stderr, name).toContain('contradictory');
        expect(r.calls, name).toEqual([]);
      }
    });

    it('down and status never refuse on off: off alone renders the off overlay, off with a jar renders no ledger file', () => {
      const offAlone = runScript(
        ['down'],
        { ...AUTH, SCRATCH_PLATFORM: 'neoforge', SCRATCH_NEOFORGE_TELEMETRY: 'off' },
        JARS,
      );
      expect(offAlone.status).toBe(0);
      expect(offAlone.calls.join('\n')).toContain('opt-in/scratch-neoforge-ledger-off.yml');
      for (const verb of ['down', 'status']) {
        const r = runScript([verb], ledgerEnv('off'), JARS);
        expect(r.status, verb).toBe(0);
        expect(r.stderr, verb).not.toContain('nothing started');
        expect(r.calls.join('\n'), verb).not.toContain('scratch-neoforge-ledger.yml');
      }
    });

    it('with neither variable the up command has no ledger overlay and no off overlay: the default render is unchanged', () => {
      const r = runScript(['up'], { ...AUTH, SCRATCH_PLATFORM: 'neoforge' }, JARS);
      expect(r.status).toBe(0);
      const up = upLine(r.calls);
      expect(up).toContain('opt-in/scratch-neoforge.yml');
      expect(up).not.toContain('scratch-neoforge-ledger.yml');
      expect(up).not.toContain('scratch-neoforge-ledger-off.yml');
    });

    it('down and status run after the jar is deleted: only up refuses on the ledger variables', () => {
      const gone = (base: string): Env => {
        const env = ledgerEnv(LEDGER_SHA, { agent: true })(base);
        unlinkSync(join(base, 'ledger.jar'));
        return env;
      };
      const down = runScript(['down'], gone, JARS);
      expect(down.status).toBe(0);
      expect(down.stderr).not.toContain('nothing started');
      expect(down.calls.some((c) => c.includes(' down -v'))).toBe(true);
      const status = runScript(['status'], gone, JARS);
      expect(status.status).toBe(0);
      expect(status.calls.length).toBeGreaterThan(0);
    });

    it('down with a malformed hash still runs and renders without the ledger overlay', () => {
      const r = runScript(['down'], ledgerEnv('NOT-A-HASH'), JARS);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain('64 lowercase hex digits');
      expect(r.calls.join('\n')).not.toContain('scratch-neoforge-ledger.yml');
    });
  },
);

interface LedgerOverlay {
  services: {
    paper: {
      environment: Record<string, string>;
      volumes: {
        type: string;
        source: string;
        target: string;
        read_only?: boolean;
        bind?: { create_host_path?: boolean };
      }[];
    };
  };
  networks?: unknown;
}
const OVERLAY = parse(OVERLAY_TEXT) as LedgerOverlay;

describe('scratch-neoforge-ledger.yml: the render when the variables are set', () => {
  it('changes only the paper service and declares no network', () => {
    expect(Object.keys(OVERLAY.services)).toEqual(['paper']);
    expect(OVERLAY.networks).toBeUndefined();
    expect(OVERLAY_TEXT).not.toMatch(/external:|networks:/);
  });

  it('mounts the four files read-only, each from a host variable, with create_host_path false', () => {
    const mounts = OVERLAY.services.paper.volumes;
    expect(mounts.map((m) => m.target)).toEqual([
      '/geldar/mods/geldar-neoforge-ledger.jar',
      '/geldar/telemetry/opentelemetry-javaagent.jar',
      '/geldar/telemetry/otel-agent.properties',
      '/geldar/telemetry/ledger.properties',
    ]);
    for (const mount of mounts) {
      expect(mount.type, mount.target).toBe('bind');
      expect(mount.read_only, mount.target).toBe(true);
      expect(mount.bind?.create_host_path, mount.target).toBe(false);
      expect(mount.source, mount.target).toMatch(/^\$\{GELDAR_NF_[A-Z_]+_HOST:\?[^}]+\}$/);
    }
  });

  it('nests no bind under /data: the telemetry files sit under /geldar/telemetry and the entrypoint copies the config', () => {
    const targets = OVERLAY.services.paper.volumes.map((m) => m.target);
    for (const target of targets) {
      expect(target === '/data' || target.startsWith('/data/'), target).toBe(false);
    }
    expect(targets.filter((t) => t.startsWith('/geldar/telemetry/'))).toHaveLength(3);
  });

  it('sets the on switch, the ledger pin (required) and the agent pin constant on paper', () => {
    const env = OVERLAY.services.paper.environment;
    expect(env.GELDAR_NF_TELEMETRY).toBe('on');
    expect(env.GELDAR_NF_LEDGER_SHA256).toMatch(/^\$\{GELDAR_NF_LEDGER_SHA256:\?[^}]+\}$/);
    expect(env.GELDAR_NF_OTEL_AGENT_SHA256).toBe(
      'e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149',
    );
  });

  it('is never in the base overlay: the default render has no ledger mount or variable', () => {
    expect(NF_TEXT).not.toContain('geldar-neoforge-ledger.jar');
    expect(NF_TEXT).not.toContain('GELDAR_NF_LEDGER');
    expect(NF_TEXT).not.toContain('GELDAR_NF_OTEL');
  });
});

describe('the agent pin constant: one sha256 in the overlay, the host script and the design doc', () => {
  const PIN = 'e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149';

  it('the overlay env, the host script constant and the design doc all state the same pin', () => {
    expect(OVERLAY.services.paper.environment.GELDAR_NF_OTEL_AGENT_SHA256).toBe(PIN);
    expect(LEDGER_SCRIPT.match(/^ledger_agent_pin=([0-9a-f]{64})$/m)?.[1]).toBe(PIN);
    expect(DOC_TEXT).toContain(PIN);
  });
});

describe('scratch-neoforge-ledger-off.yml: the soft kill render', () => {
  const off = parse(OFF_TEXT) as {
    services: { paper: { environment: Record<string, string>; volumes?: unknown } };
    networks?: unknown;
  };

  it('sets only GELDAR_NF_TELEMETRY=off on paper, with a literal value, and no volume, mount or network', () => {
    expect(Object.keys(off.services)).toEqual(['paper']);
    expect(off.services.paper.environment).toEqual({ GELDAR_NF_TELEMETRY: 'off' });
    expect(off.services.paper.volumes).toBeUndefined();
    expect(off.networks).toBeUndefined();
    expect(OFF_TEXT).not.toMatch(/volumes:|networks:|external:|\$\{/);
  });
});
