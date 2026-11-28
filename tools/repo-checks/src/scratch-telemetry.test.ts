/**
 * The scratch-telemetry overlay (compose/opt-in/scratch-telemetry.yml), its wiring in deploy/scratch/scratch.sh and the
 * verify script deploy/scratch/telemetry-verify.sh (PT-03k). The overlay is parsed with the yaml package and, where docker
 * compose is installed, rendered with `config` (never `up`). The scripts run under sh with stubs; nothing starts a container.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CollectionTag, parse } from 'yaml';
import { AUTH, JARS, runScript, SH, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-telemetry.yml`, 'utf8');
const SCRATCH_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch.yml`, 'utf8');
const VERIFY = `${ROOT}deploy/scratch/telemetry-verify.sh`;
// colo.yml sets its own Paper limit (15360m, COLO-COMPOSE-RECONCILE), so it is not checked for that value; it must only
// never name the scratch overlay.
const LIVE_FILES = ['phase0.yml', 'nats-auth.yml'].map((f) => `${ROOT}compose/${f}`);
const COLO_TEXT = readFileSync(`${ROOT}compose/colo.yml`, 'utf8');

const OVERRIDE: CollectionTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};
interface Service {
  image?: string;
  ports?: unknown;
  restart?: string;
  labels?: Record<string, string>;
  memswap_limit?: string;
  environment?: Record<string, string>;
  volumes?: string[];
  networks?: { default?: { aliases?: string[] } };
  deploy?: { resources: { limits: { memory: string; cpus: string } } };
}
interface Overlay {
  services: Record<string, Service>;
  configs: Record<string, { content: string }>;
}
const OVERLAY = parse(OVERLAY_TEXT) as Overlay;
const SCRATCH = parse(SCRATCH_TEXT, { customTags: [OVERRIDE] }) as Overlay;
const sink = OVERLAY.services['otel-sink'] as Service;
const paper = OVERLAY.services.paper as Service;

describe('scratch-telemetry overlay', () => {
  it('sets the Paper limit to exactly 15360m here and keeps 3072m in scratch.yml', () => {
    expect(paper.deploy?.resources.limits.memory).toBe('15360m');
    expect(paper.memswap_limit).toBe('15360m');
    expect(SCRATCH.services.paper?.deploy?.resources.limits.memory).toBe('3072m');
    expect(SCRATCH.services.paper?.memswap_limit).toBe('3072m');
    for (const file of LIVE_FILES) expect(readFileSync(file, 'utf8')).not.toContain('15360m');
    expect(COLO_TEXT).not.toContain('scratch');
    const others = Object.entries(OVERLAY.services).filter(([name]) => name !== 'paper');
    for (const [, s] of others) expect(s.deploy?.resources.limits.memory).not.toBe('15360m');
  });

  it('gives otel-sink no ports and the geldar-gateway alias on the default (scratch) network', () => {
    expect(sink).not.toHaveProperty('ports');
    expect(paper).not.toHaveProperty('ports');
    expect(sink.networks?.default?.aliases).toEqual(['geldar-gateway']);
    expect(sink.deploy?.resources.limits.memory).toBe('512m');
  });

  it('names no live network, live secret or other service network', () => {
    expect(OVERLAY_TEXT).not.toMatch(/geldar-colo|geldar-telemetry|^\s*external:|^\s*secrets:/m);
    expect(OVERLAY_TEXT).not.toMatch(/\/mnt\/|nvme|GELDAR_STATE_DIR/);
    expect(OVERLAY.services).not.toHaveProperty('networks');
    expect(Object.keys(OVERLAY.services).sort()).toEqual(['otel-sink', 'paper']);
  });

  it('holds no IP address other than 127.0.0.1', () => {
    const ips = OVERLAY_TEXT.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(ips.filter((ip) => ip !== '127.0.0.1')).toEqual([]);
  });

  it('gives every service the scratch label and restart "no"', () => {
    for (const [name, s] of Object.entries(OVERLAY.services)) {
      expect(s.labels?.['geldar.scratch'], name).toBe('true');
      expect(s.restart, name).toBe('no');
    }
  });

  it('pins the sink image by digest, the one already used by the gateway compose file', () => {
    expect(sink.image).toMatch(/^otel\/opentelemetry-collector-contrib@sha256:[0-9a-f]{64}$/);
    const gateway = readFileSync(`${ROOT}deploy/telemetry/compose.gateway.yml`, 'utf8');
    expect(gateway).toContain(sink.image as string);
  });

  it('mounts the jar, the profile and the config read-only, and the agent only through SCRATCH_OTEL_AGENT_JAR', () => {
    const vols = paper.volumes ?? [];
    expect(vols).toContain('../plugin/ledger/build/libs/ledger.jar:/plugins/ledger.jar:ro');
    expect(vols).toContain('./paper/otel-agent.properties:/opt/otel/otel-agent.properties:ro');
    expect(vols).toContain(
      '../deploy/scratch/ledger.properties:/data/plugins/Ledger/ledger.properties:ro',
    );
    for (const v of vols) expect(v, v).toMatch(/:ro$/);
    expect(paper.environment?.JAVA_AGENTS).toBe(
      `\${SCRATCH_OTEL_AGENT_JAR:+/opt/otel/opentelemetry-javaagent.jar}`,
    );
    expect(paper.environment?.MEMORY).toBe(`\${PAPER_MEMORY:-10G}`);
    const props = readFileSync(`${ROOT}deploy/scratch/ledger.properties`, 'utf8');
    expect(props).toMatch(/^enabled=true$/m);
    for (const id of [
      'tick',
      'spark',
      'world',
      'server',
      'census',
      'curated',
      'connections',
      'snapshots',
      'progress',
      'cadence',
      'bridge',
      'container',
      'disk',
    ]) {
      expect(props, id).toMatch(new RegExp(`^collector\\.${id}\\.enabled=true$`, 'm'));
    }
    expect(props).not.toMatch(/^\s*[^#\s][^=]*(password|token|secret)/im);
  });

  it('writes the sink output to a required host directory, with no secret-looking variable', () => {
    expect(sink.volumes?.[0]).toMatch(/^\$\{SCRATCH_TELEMETRY_OUT:\?[^}]+\}:\/out$/);
    expect(OVERLAY.configs['otel-sink']?.content).toContain('endpoint: ":4318"');
    expect(OVERLAY_TEXT).not.toMatch(/PASSWORD|TOKEN|SECRET/);
  });
});

const COMPOSE = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' });
describe.skipIf(COMPOSE.status !== 0)('scratch-telemetry overlay: docker compose config', () => {
  const env = {
    ...process.env,
    SCRATCH_TELEMETRY_OUT: slash(tmpdir()),
    SCRATCH_SECRETS_DIR: slash(tmpdir()),
    GELDAR_WORLD_VOLUME: 'scratch-telemetry_paper-data',
    SCRATCH_RUN_UID: '1000',
    SCRATCH_RUN_GID: '1000',
  };
  const render = (e: NodeJS.ProcessEnv) =>
    spawnSync(
      'docker',
      [
        'compose',
        '-p',
        'scratch-telemetry',
        '-f',
        `${ROOT}compose/phase0.yml`,
        '-f',
        `${ROOT}compose/opt-in/scratch.yml`,
        '-f',
        `${ROOT}compose/opt-in/scratch-telemetry.yml`,
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: e },
    );

  it('renders: Paper 15 GiB, the sink answers as geldar-gateway with no published port', () => {
    const run = render(env);
    expect(run.status, run.stderr).toBe(0);
    const cfg = JSON.parse(run.stdout) as {
      services: Record<string, Record<string, unknown> & { ports?: unknown[] }>;
    };
    const limits = (n: string) =>
      (cfg.services[n] as unknown as { deploy: { resources: { limits: { memory: string } } } })
        .deploy.resources.limits;
    expect(limits('paper').memory).toBe(String(15360 * 1024 * 1024));
    expect(limits('otel-sink').memory).toBe(String(512 * 1024 * 1024));
    expect(cfg.services['otel-sink']?.ports).toBeUndefined();
    expect(JSON.stringify(cfg.services['otel-sink']?.networks)).toContain('geldar-gateway');
    const publishedHosts = Object.values(cfg.services)
      .flatMap((s) => (s.ports ?? []) as { host_ip?: string }[])
      .map((p) => p.host_ip);
    for (const host of publishedHosts) expect(host).toBe('127.0.0.1');
    expect(JSON.stringify(cfg.services.paper?.environment)).toContain('"JAVA_AGENTS":""');
  });

  it('puts the agent in JAVA_AGENTS only when SCRATCH_OTEL_AGENT_JAR is set', () => {
    const run = render({ ...env, SCRATCH_OTEL_AGENT_JAR: slash(join(tmpdir(), 'agent.jar')) });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('/opt/otel/opentelemetry-javaagent.jar');
    expect(JSON.parse(run.stdout).services.paper.environment.JAVA_AGENTS).toBe(
      '/opt/otel/opentelemetry-javaagent.jar',
    );
  });

  it('refuses to render without SCRATCH_TELEMETRY_OUT', () => {
    const { SCRATCH_TELEMETRY_OUT: _omit, ...rest } = env;
    const run = render(rest);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('SCRATCH_TELEMETRY_OUT');
  });
});

describe.skipIf(!SH)('scratch.sh: the telemetry overlay file list', { timeout: 60_000 }, () => {
  const composeCall = (run: { calls: string[] }) =>
    run.calls.find((c) => c.startsWith('compose') && c.includes(' up -d'));

  it('up telemetry adds scratch-telemetry.yml after scratch.yml, once, to both the up and the status call', () => {
    const run = runScript(['up', 'telemetry'], AUTH, JARS);
    expect(run.status).toBe(0);
    const calls = run.calls.filter((c) => c.startsWith('compose') && c.includes('-p scratch-'));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const files = [...c.matchAll(/-f (\S+)/g)].map((m) => m[1] as string);
      const names = files.map((f) => f.split('/').slice(-3).join('/'));
      const scratch = names.findIndex((n) => n.endsWith('opt-in/scratch.yml'));
      const tele = names.findIndex((n) => n.endsWith('opt-in/scratch-telemetry.yml'));
      expect(scratch, c).toBeGreaterThan(-1);
      expect(tele, c).toBe(scratch + 1);
      expect(
        names.filter((n) => n.endsWith('scratch-telemetry.yml')),
        c,
      ).toHaveLength(1);
    }
    expect(composeCall(run)).toContain('-p scratch-telemetry ');
  });

  it('down telemetry carries the overlay too', () => {
    const run = runScript(['down', 'telemetry'], {}, JARS);
    expect(
      run.calls.some((c) => c.includes('scratch-telemetry.yml') && c.includes(' down -v')),
    ).toBe(true);
  });

  it('up scratch-a and other suffixes never get the telemetry overlay', () => {
    for (const args of [['up'], ['up', 'b'], ['status', 'a']]) {
      const run = runScript(args, AUTH, JARS);
      expect(run.status, args.join(' ')).toBe(0);
      expect(run.calls.join('\n'), args.join(' ')).not.toContain('scratch-telemetry.yml');
    }
  });
});

const NAME = 'geldar_tick_lag_ms';
const FIXTURE = [
  `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"${NAME}","gauge":{"dataPoints":[{"asDouble":3.5}]}},{"name":"other_metric","sum":{"dataPoints":[{"asInt":"9"}]}}]}]}]}`,
  `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"${NAME}","gauge":{"dataPoints":[{"asDouble":7.25}]}}]}]}]}`,
  `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"eventName":"geldar.server.stall","attributes":[{"key":"geldar.duration_ms","value":{"intValue":"2500"}}]}]}]}]}`,
].join('\n');

function verify(
  args: string[],
  fixture: string | null = FIXTURE,
  unsetDir = false,
  extra: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'tele-out-'));
  try {
    mkdirSync(join(dir, 'sub'));
    if (fixture !== null) writeFileSync(join(dir, 'otlp.jsonl'), `${fixture}\n`);
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', ...extra };
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    if (!unsetDir) env.SCRATCH_TELEMETRY_OUT = slash(dir);
    return spawnSync(SH as string, [slash(VERIFY), ...args], { encoding: 'utf8', env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each case spawns sh and a chain of MSYS tools; under a parallel suite run one case took about 7 s, over the 5 s default.
describe.skipIf(!SH)('telemetry-verify.sh against a fixture JSONL', { timeout: 120_000 }, () => {
  it('metric: found prints the count and the last value, exit 0', () => {
    const r = verify(['metric', NAME]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('count=2');
    expect(r.stdout).toContain('last=7.25');
  });

  it('metric: an integer data point is read from asInt', () => {
    const r = verify(['metric', 'other_metric']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('last=9');
  });

  it('metric: not found prints count=0 and exits 1', () => {
    const r = verify(['metric', 'geldar_missing']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('count=0');
  });

  it('metric: the expected value is compared with the last value, not the first', () => {
    expect(verify(['metric', NAME, '7.25']).status).toBe(0);
    expect(verify(['metric', NAME, '7.250']).status).toBe(0);
    expect(verify(['metric', NAME, '3.5']).status).toBe(1);
  });

  it('metric: a histogram is not read as the next metric (req 02 finding 5), max and histcount read the named metric', () => {
    const hist = (count: number, tps: number, frozen: number) =>
      `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"${NAME}","histogram":{"dataPoints":[{"count":"${count}","sum":12.5}]}},{"name":"geldar_tps","gauge":{"dataPoints":[{"asDouble":${tps}}]}},{"name":"geldar_tick_frozen","gauge":{"dataPoints":[{"asInt":"${frozen}"}]}}]}]}]}`;
    const fx = [hist(81, 19.999, 0), hist(381, 20.1, 1), hist(681, 20.2, 0)].join('\n');
    // old behaviour returned the neighbour: last=20.2 for the histogram name
    const m = verify(['metric', NAME], fx);
    expect(m.stdout).toContain('last=none');
    expect(m.stdout).not.toContain('20.2');
    const g = verify(['metric', 'geldar_tps', '20.2'], fx);
    expect(g.status, g.stderr).toBe(0);
    const h = verify(['histcount', NAME, '600'], fx);
    expect(h.status, h.stderr).toBe(0);
    expect(h.stdout).toContain('first=81 last=681 delta=600');
    expect(verify(['histcount', NAME, '601'], fx).status).toBe(1);
    expect(verify(['histcount', 'geldar_tps'], fx).status).toBe(1);
    // last value is 0 (the freeze was missed), max over the window is 1
    expect(verify(['metric', 'geldar_tick_frozen', '1'], fx).status).toBe(1);
    const x = verify(['max', 'geldar_tick_frozen', '1'], fx);
    expect(x.status, x.stderr).toBe(0);
    expect(x.stdout).toContain('max=1');
    expect(verify(['max', 'geldar_tps', '21'], fx).status).toBe(1);
  });

  it('metric and max: name@key=value reads one series of a labelled metric (G1), the reset is visible', () => {
    const pt = (c: string, v: number) =>
      `{"attributes":[{"key":"collector","value":{"stringValue":"${c}"}}],"timeUnixNano":"1","asInt":"${v}"}`;
    const ex = (census: number, tick: number) =>
      `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"geldar_paper_collector_disabled","gauge":{"dataPoints":[${pt('census', census)},${pt('tick', tick)}]}},{"name":"geldar_tps","gauge":{"dataPoints":[{"asDouble":20}]}}]}]}]}`;
    const fx = [ex(0, 0), ex(1, 0), ex(0, 1)].join('\n'); // census trips then resets; tick is 1 in the last export
    const n = 'geldar_paper_collector_disabled';
    // the last series of the last export is tick=1: an unfiltered metric read gives 1, census is 0
    expect(verify(['metric', n, '1'], fx).status).toBe(0);
    expect(verify(['metric', `${n}@collector=census`, '0'], fx).status).toBe(0);
    expect(verify(['metric', `${n}@collector=tick`, '1'], fx).status).toBe(0);
    const m = verify(['max', `${n}@collector=census`, '1'], fx);
    expect(m.status, m.stderr).toBe(0);
    expect(m.stdout).toContain('max=1');
    expect(verify(['max', `${n}@collector=world`, '1'], fx).status).toBe(1);
    expect(verify(['max', `${n}@collector=tick`], ex(0, 0)).stdout).toContain('max=0');
    expect(verify(['max', `${n}@collector=`], fx).status).toBe(2);
  });

  it('SCRATCH_TELEMETRY_SINCE_LINE must be a non-negative integer (usage error, exit 2) and skips lines', () => {
    for (const bad of ['abc', '-5', '1;echo pwned', '1.5']) {
      const r = verify(['metric', NAME], FIXTURE, false, { SCRATCH_TELEMETRY_SINCE_LINE: bad });
      expect(r.status, bad).toBe(2);
    }
    const skip = verify(['metric', NAME], FIXTURE, false, { SCRATCH_TELEMETRY_SINCE_LINE: '1' });
    expect(skip.stdout).toContain('count=1');
    expect(
      verify(['metric', NAME], FIXTURE, false, { SCRATCH_TELEMETRY_SINCE_LINE: '2' }).status,
    ).toBe(1);
  });

  it('metric: a name that is only a prefix of another does not match', () => {
    expect(verify(['metric', 'geldar_tick']).status).toBe(1);
  });

  it('event: found prints the count and the last record; a text must be in that record', () => {
    const r = verify(['event', 'geldar.server.stall', '2500']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('count=1');
    expect(r.stdout).toContain('geldar.duration_ms');
    expect(verify(['event', 'geldar.server.stall', '9999']).status).toBe(1);
    expect(verify(['event', 'geldar.server.nothing']).status).toBe(1);
  });

  it('absent: exits 1 when the string occurs and 0 when it does not', () => {
    const hit = verify(['absent', 'other_metric']);
    expect(hit.status).toBe(1);
    expect(hit.stdout).toContain('present');
    const miss = verify(['absent', 'rcon-password-value']);
    expect(miss.status, miss.stderr).toBe(0);
    expect(miss.stdout).toContain('absent');
  });

  it('absent treats a dot as a literal, not a pattern', () => {
    expect(verify(['absent', 'geldar.server_stall']).status).toBe(0);
    expect(verify(['absent', 'geldar.server.stall']).status).toBe(1);
  });

  it('usage errors and an unreadable directory exit 2; an empty directory counts as not found', () => {
    expect(verify([]).status).toBe(2);
    expect(verify(['bogus', 'x']).status).toBe(2);
    expect(verify(['metric', 'bad name']).status).toBe(2);
    expect(verify(['metric', NAME], FIXTURE, true).status).toBe(2);
    expect(verify(['metric', NAME], null).status).toBe(1);
    expect(verify(['absent', 'x'], null).status).toBe(0);
  });
});
