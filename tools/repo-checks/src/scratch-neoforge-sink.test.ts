/**
 * The OTLP sink on the scratch NeoForge stack: SCRATCH_NEOFORGE_TELEMETRY_SINK in deploy/scratch/scratch-ledger.sh and
 * scratch.sh (run under sh with the stub harness, so nothing starts), and the overlay
 * compose/opt-in/scratch-neoforge-telemetry.yml (parsed, and compared with the Paper scratch sink it copies).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AUTH, type Env, JARS, runScript, skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge-telemetry.yml`, 'utf8');
const PAPER_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-telemetry.yml`, 'utf8');
interface Service {
  image?: string;
  ports?: unknown;
  networks?: Record<string, { aliases?: string[] }>;
  depends_on?: string[];
  user?: string;
  restart?: string;
  labels?: Record<string, string>;
  memswap_limit?: string;
  volumes?: string[];
  deploy?: { resources: { limits: { memory: string; cpus: string } } };
}
interface Overlay {
  services: Record<string, Service>;
  configs: Record<string, { content: string }>;
  networks?: unknown;
}
const OVERLAY = parse(OVERLAY_TEXT) as Overlay;
const PAPER = parse(PAPER_TEXT) as Overlay;
const sink = OVERLAY.services['otel-sink'] as Service;
const paperSink = PAPER.services['otel-sink'] as Service;

const SINK = 'opt-in/scratch-neoforge-telemetry.yml';
const NF = { ...AUTH, SCRATCH_PLATFORM: 'neoforge' };
const upLine = (calls: string[]) => calls.find((c) => c.includes(' up -d')) ?? '';
/** An existing directory under the stub base dir, as the environment value of SCRATCH_TELEMETRY_OUT. */
const withOut =
  (extra: Env = {}) =>
  (base: string): Env => {
    const out = join(base, 'sink-out');
    mkdirSync(out, { recursive: true });
    return {
      ...NF,
      SCRATCH_NEOFORGE_TELEMETRY_SINK: '1',
      SCRATCH_TELEMETRY_OUT: slash(out),
      ...extra,
    };
  };

describe('scratch-neoforge-telemetry overlay', () => {
  it('has no published port, no network of its own and no top-level network', () => {
    expect(sink).not.toHaveProperty('ports');
    expect(OVERLAY.services.paper).not.toHaveProperty('ports');
    expect(OVERLAY).not.toHaveProperty('networks');
    expect(Object.keys(sink.networks ?? {})).toEqual(['default']);
    expect(OVERLAY.services.paper).not.toHaveProperty('networks');
    expect(OVERLAY_TEXT).not.toMatch(/geldar-colo|geldar-telemetry|^\s*external:|^\s*secrets:/m);
    expect(Object.keys(OVERLAY.services).sort()).toEqual(['otel-sink', 'paper']);
  });

  it('answers as geldar-gateway, the host the agent properties file names', () => {
    expect(sink.networks?.default?.aliases).toEqual(['geldar-gateway']);
    const props = readFileSync(`${ROOT}compose/neoforge/otel-agent.properties`, 'utf8');
    expect(props).toMatch(/^otel\.exporter\.otlp\.endpoint=http:\/\/geldar-gateway:4318$/m);
  });

  it('uses the image digest of the Paper scratch sink, and the same config, caps, user and output', () => {
    expect(sink.image).toMatch(/^otel\/opentelemetry-collector-contrib@sha256:[0-9a-f]{64}$/);
    expect(sink.image).toBe(paperSink.image);
    expect(OVERLAY.configs['otel-sink']).toEqual(PAPER.configs['otel-sink']);
    expect(sink.deploy).toEqual(paperSink.deploy);
    expect(sink.memswap_limit).toBe('512m');
    expect(sink.user).toBe(paperSink.user);
    expect(sink.volumes).toEqual(paperSink.volumes);
    expect(sink.volumes?.[0]).toMatch(/^\$\{SCRATCH_TELEMETRY_OUT:\?[^}]+\}:\/out$/);
    expect(sink.labels?.['geldar.scratch']).toBe('true');
    expect(sink.restart).toBe('no');
  });

  it('makes the NeoForge service (named paper) depend on the sink', () => {
    expect(OVERLAY.services.paper?.depends_on).toEqual(['otel-sink']);
  });
});

describe.skipIf(skipWithoutSh())(
  'scratch.sh: SCRATCH_NEOFORGE_TELEMETRY_SINK',
  { timeout: 60_000 },
  () => {
    it('adds the sink overlay after the NeoForge overlay and before the NATS override', () => {
      const run = runScript(['up', 'nf'], withOut(), JARS);
      const up = upLine(run.calls);
      expect(run.status).toBe(0);
      expect(up).toContain(SINK);
      expect(up.indexOf('opt-in/scratch-neoforge.yml')).toBeLessThan(up.indexOf(SINK));
      expect(up.indexOf(SINK)).toBeLessThan(up.indexOf('nats-override.yml'));
    });

    it('is layered after the ledger overlay when both are set', () => {
      // The only place this file names the ledger variables (the jar pair and its config): a rename is an edit here.
      const run = runScript(
        ['up', 'nf'],
        (base) => {
          const jar = join(base, 'ledger.jar');
          const props = join(base, 'ledger.properties');
          writeFileSync(jar, 'ledger fixture');
          writeFileSync(props, 'x=1\n');
          return {
            ...withOut()(base),
            SCRATCH_NEOFORGE_LEDGER_JAR: slash(jar),
            SCRATCH_NEOFORGE_LEDGER_SHA256: createHash('sha256')
              .update('ledger fixture')
              .digest('hex'),
            SCRATCH_LEDGER_PROPS: slash(props),
          };
        },
        JARS,
      );
      const up = upLine(run.calls);
      expect(run.status).toBe(0);
      expect(up).toContain('opt-in/scratch-neoforge-ledger.yml');
      expect(up.indexOf('opt-in/scratch-neoforge-ledger.yml')).toBeLessThan(up.indexOf(SINK));
    });

    it('leaves the overlay out by default, with the variable unset, empty or the platform paper', () => {
      const baseline = runScript(['up', 'nf'], NF, JARS);
      expect(baseline.status).toBe(0);
      expect(upLine(baseline.calls)).not.toContain('telemetry');
      expect(upLine(baseline.calls)).not.toContain('otel-sink');
      const empty = runScript(['up', 'nf'], { ...NF, SCRATCH_NEOFORGE_TELEMETRY_SINK: '' }, JARS);
      const norm = (calls: string[]) => calls.map((c) => c.replace(/scratch-stub-\w+/g, 'BASE'));
      expect(norm(empty.calls)).toEqual(norm(baseline.calls));
      for (const verb of ['down', 'status']) {
        const run = runScript([verb, 'nf'], { SCRATCH_PLATFORM: 'neoforge' });
        expect(run.calls.join('\n')).not.toContain('telemetry');
      }
    });

    it('does not change the default render of a paper project, even with the variable set on down', () => {
      const paper = runScript(['up', 'a'], AUTH, JARS);
      expect(upLine(paper.calls)).not.toContain('telemetry');
      const down = runScript(['down', 'a'], {
        SCRATCH_NEOFORGE_TELEMETRY_SINK: '1',
        SCRATCH_TELEMETRY_OUT: '/tmp/x',
      });
      expect(down.status).not.toBe(2);
      expect(down.calls.join('\n')).not.toContain(SINK);
    });

    it('up refuses with exit 2 before any docker call without SCRATCH_TELEMETRY_OUT', () => {
      const run = runScript(
        ['up', 'nf'],
        (base) => {
          const { SCRATCH_TELEMETRY_OUT: _omit, ...rest } = withOut()(base);
          return rest;
        },
        JARS,
      );
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('SCRATCH_TELEMETRY_OUT');
      expect(run.calls).toEqual([]);
    });

    it('up refuses with exit 2 on a relative, missing, file or ill-shaped directory, a bad value, or the paper platform', () => {
      const cases: Env[] = [
        { SCRATCH_TELEMETRY_OUT: 'relative/out' },
        { SCRATCH_TELEMETRY_OUT: '/no/such/dir/at/all' },
        { SCRATCH_TELEMETRY_OUT: '/tmp/a"b' },
        { SCRATCH_TELEMETRY_OUT: '/tmp/a$b' },
        { SCRATCH_TELEMETRY_OUT: '/tmp/a\nb' },
        { SCRATCH_NEOFORGE_TELEMETRY_SINK: 'yes' },
        { SCRATCH_PLATFORM: 'paper' },
      ];
      for (const extra of cases) {
        const run = runScript(['up', 'nf'], withOut(extra), JARS);
        expect(run.status, JSON.stringify(extra)).toBe(2);
        expect(run.calls, JSON.stringify(extra)).toEqual([]);
      }
      const file = runScript(
        ['up', 'nf'],
        (base) => {
          const f = join(base, 'a-file');
          writeFileSync(f, 'x');
          return withOut({ SCRATCH_TELEMETRY_OUT: slash(f) })(base);
        },
        JARS,
      );
      expect(file.status).toBe(2);
      expect(file.calls).toEqual([]);
    });

    it('down and status pass the overlay when the variables are well formed and never refuse on them', () => {
      for (const verb of ['down', 'status']) {
        const ok = runScript([verb, 'nf'], withOut());
        expect(ok.calls.join('\n'), verb).toContain(SINK);
        const bad = runScript([verb, 'nf'], withOut({ SCRATCH_TELEMETRY_OUT: 'relative' }));
        expect(bad.status, verb).not.toBe(2);
        expect(bad.calls.join('\n'), verb).not.toContain(SINK);
        const gone = runScript([verb, 'nf'], withOut({ SCRATCH_NEOFORGE_TELEMETRY_SINK: 'yes' }));
        expect(gone.status, verb).not.toBe(2);
      }
    });
  },
);
