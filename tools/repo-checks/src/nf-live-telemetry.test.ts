/**
 * The optional telemetry overlay of the live NeoForge project (compose/nf-live-telemetry.yml, added on top of
 * compose/nf-live.yml only when NF_TELEMETRY=on). The base file is not changed, so its default render is unchanged. The
 * renders use dummy inputs and fixture paths; nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE = 'compose/nf-live.yml';
const OVERLAY = 'compose/nf-live-telemetry.yml';
const OVERLAY_TEXT = readFileSync(`${ROOT}${OVERLAY}`, 'utf8');
// The OpenTelemetry Java agent 2.33.1 pin, as docs/analysis/telemetry/nf-live-telemetry.md (section 0a) records it.
const AGENT_PIN = 'e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149';
const DUMMY_SHA = 'a'.repeat(64);
const SECRET_NAMES = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-auth.conf',
  'nats-sink.txt',
  'nats-neoforge.txt',
  'nats-velocity.txt',
  'nats-deploy.txt',
  'nats-seed.txt',
];
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
if (!DOCKER && process.env.CI)
  throw new Error(
    'docker compose is not on PATH and CI is set: the nf-live telemetry render tests must run',
  );

interface Mount {
  type?: string;
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: { create_host_path?: boolean };
}
interface Svc {
  image?: string;
  networks?: Record<string, unknown>;
  environment?: Record<string, string | null>;
  volumes?: Mount[];
  ports?: unknown[];
}
interface Rendered {
  services: Record<string, Svc>;
  networks?: Record<string, { external?: boolean; name?: string }>;
}

function render(
  files: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string } {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(merged)) if (key.startsWith('NF_')) delete merged[key];
  Object.assign(merged, env);
  const fileArgs = files.flatMap((f) => ['-f', f]);
  const run = spawnSync(
    'docker',
    ['compose', '-p', 'geldar-nf', ...fileArgs, 'config', '--format', 'json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: merged,
    },
  );
  return { status: run.status, stdout: run.stdout };
}

// The telemetry mounts: the host variable, the container path. The agent jar and the four files are read-only.
const MOUNTS: [string, string][] = [
  ['NF_LEDGER_JAR_HOST', '/geldar/mods/geldar-neoforge-ledger.jar'],
  ['NF_OTEL_AGENT_HOST', '/geldar/telemetry/opentelemetry-javaagent.jar'],
  ['NF_OTEL_AGENT_PROPS_HOST', '/geldar/telemetry/otel-agent.properties'],
  ['NF_LEDGER_PROPS_HOST', '/geldar/telemetry/ledger.properties'],
];

let on: Rendered;
let off: Rendered;
let hostPaths: Record<string, string>;
let tmp: string;

beforeAll(() => {
  if (!DOCKER) return;
  tmp = mkdtempSync(join(tmpdir(), 'nf-live-telemetry-'));
  const secrets = join(tmp, 'secrets');
  mkdirSync(secrets);
  for (const name of SECRET_NAMES) writeFileSync(join(secrets, name), 'DUMMY-NF-SECRET\n');
  const jar = join(tmp, 'geldar-neoforge.jar');
  writeFileSync(jar, 'dummy jar, not a real mod');
  hostPaths = {};
  for (const [name] of MOUNTS) hostPaths[name] = join(tmp, `${name.toLowerCase()}.file`);
  const common = { NF_SECRETS_DIR: secrets, NF_MOD_JAR_HOST: jar, NF_MOD_SHA256: DUMMY_SHA };
  const withTelemetry = render([BASE, OVERLAY], {
    ...common,
    ...hostPaths,
    NF_TELEMETRY: 'on',
    NF_LEDGER_SHA256: DUMMY_SHA,
  });
  if (withTelemetry.status !== 0) throw new Error('compose config of base plus overlay failed');
  on = JSON.parse(withTelemetry.stdout) as Rendered;
  const withoutTelemetry = render([BASE], common);
  if (withoutTelemetry.status !== 0) throw new Error('compose config of the base file failed');
  off = JSON.parse(withoutTelemetry.stdout) as Rendered;
}, 30_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('nf-live telemetry overlay: the pinned constants (no docker needed)', () => {
  it('pins the OpenTelemetry agent to the design doc value, as a constant in the overlay', () => {
    expect(OVERLAY_TEXT).toContain(`GELDAR_NF_OTEL_AGENT_SHA256: "${AGENT_PIN}"`);
    const doc = readFileSync(`${ROOT}docs/analysis/telemetry/nf-live-telemetry.md`, 'utf8');
    expect(doc).toContain(AGENT_PIN);
  });

  it('equals the agent pin of the scratch opt-in ledger overlay once that file has landed', () => {
    const scratch = `${ROOT}compose/opt-in/scratch-neoforge-ledger.yml`;
    if (!existsSync(scratch)) return;
    expect(readFileSync(scratch, 'utf8')).toContain(AGENT_PIN);
  });

  it('is an operator input nowhere: no host variable names the agent pin', () => {
    expect(OVERLAY_TEXT).not.toMatch(/\$\{[A-Z_]*PIN[A-Z_]*[:}-]/);
  });

  // Compose omits create_host_path when false, so the render cannot show it; the file itself must say false on each mount.
  it('sets create_host_path: false on each of the four telemetry mounts in the overlay file', () => {
    const doc = parse(OVERLAY_TEXT) as {
      services: {
        neoforge: { volumes: { target?: string; bind?: { create_host_path?: unknown } }[] };
      };
    };
    for (const [, target] of MOUNTS) {
      const mount = doc.services.neoforge.volumes.find((v) => v.target === target);
      expect(mount?.bind?.create_host_path, target).toBe(false);
    }
  });
});

// The shared contract between the overlay and the entrypoint that reads it. Names are parsed from the overlay YAML, not
// copied here, so renaming an env key or a mount target in the overlay fails this block until the entrypoint follows.
describe('nf-live telemetry overlay: the entrypoint contract (no docker needed)', () => {
  const ENTRYPOINT = readFileSync(`${ROOT}compose/neoforge/neoforge-entrypoint.sh`, 'utf8');
  const NF_DEPLOY = readFileSync(`${ROOT}deploy/nf-deploy.sh`, 'utf8');
  const neo = (parse(OVERLAY_TEXT) as { services: { neoforge: Svc } }).services.neoforge;

  it('is the grep nf-deploy.sh runs before it accepts NF_TELEMETRY=on', () => {
    expect(NF_DEPLOY).toContain(
      'grep -Fq GELDAR_NF_TELEMETRY "$ROOT/compose/neoforge/neoforge-entrypoint.sh"',
    );
    expect(ENTRYPOINT).toContain('GELDAR_NF_TELEMETRY');
  });

  it('has every container env name the overlay sets on neoforge in the entrypoint source', () => {
    const names = Object.keys(neo.environment ?? {});
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ENTRYPOINT, name).toContain(name);
  });

  it('has every container mount target the overlay uses on neoforge in the entrypoint source', () => {
    const targets = (neo.volumes ?? []).map((v) => v.target ?? '');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(ENTRYPOINT, target).toContain(target);
  });

  it('has no agent pin variable and no old GELDAR_NF_OTEL_AGENT= switch', () => {
    expect(ENTRYPOINT).not.toContain('GELDAR_NF_OTEL_AGENT_PIN');
    expect(ENTRYPOINT).not.toMatch(/GELDAR_NF_OTEL_AGENT=/);
  });
});

describe.skipIf(!DOCKER)('nf-live telemetry overlay: the render', () => {
  it('renders on top of the base file, and renders alone (CI and geldar.ps1 check each compose file alone)', () => {
    expect(on.services.neoforge).toBeDefined();
    expect(render([OVERLAY], {}).status).toBe(0);
  }, 30_000);

  it('the default render (the base file alone) carries no telemetry', () => {
    const neo = off.services.neoforge;
    expect(Object.keys(neo?.networks ?? {})).toEqual(['nf']);
    expect(neo?.environment?.GELDAR_NF_TELEMETRY).toBeUndefined();
    expect(neo?.volumes?.some((v) => (v.target ?? '').startsWith('/geldar/telemetry/'))).toBe(
      false,
    );
    expect(off.networks?.telemetry).toBeUndefined();
  });

  it('gives neoforge exactly two networks with telemetry (nf and geldar-telemetry), and one without', () => {
    // RCON listens on all interfaces of neoforge, so every container on geldar-telemetry can reach port 25575 (only the password guards it).
    expect(Object.keys(on.services.neoforge?.networks ?? {}).sort()).toEqual(['nf', 'telemetry']);
    expect(Object.keys(off.services.neoforge?.networks ?? {})).toEqual(['nf']);
  });

  it('joins only the neoforge service to the external network geldar-telemetry', () => {
    for (const [name, svc] of Object.entries(on.services)) {
      const joined = Object.keys(svc.networks ?? {}).includes('telemetry');
      expect(joined, name).toBe(name === 'neoforge');
    }
    expect(on.networks?.telemetry?.external).toBe(true);
    expect(on.networks?.telemetry?.name).toBe('geldar-telemetry');
  });

  it('adds no service and publishes no port', () => {
    expect(Object.keys(on.services).sort()).toEqual(Object.keys(off.services).sort());
    // Velocity's loopback game port is the base file's; the overlay changes no service's ports.
    for (const [name, svc] of Object.entries(on.services))
      expect(svc.ports ?? [], name).toEqual(off.services[name]?.ports ?? []);
    expect(on.services.neoforge?.ports ?? []).toEqual([]);
  });

  it('mounts the four telemetry files read-only, with create_host_path false, at the fixed container paths', () => {
    for (const [name, target] of MOUNTS) {
      const mount = on.services.neoforge?.volumes?.find((v) => v.target === target);
      expect(mount, target).toBeDefined();
      expect(mount?.type).toBe('bind');
      expect(mount?.read_only).toBe(true);
      // Compose omits create_host_path when it is false (its default), so the render must never show it true.
      expect(mount?.bind?.create_host_path).not.toBe(true);
      expect(mount?.source).toBe(hostPaths[name]);
    }
  });

  it('keeps the base file mounts: the mod jar, the entrypoint and the data volume', () => {
    const targets = (on.services.neoforge?.volumes ?? []).map((v) => v.target);
    for (const t of [
      '/data',
      '/geldar/neoforge-entrypoint.sh',
      '/geldar/mods/geldar-neoforge.jar',
    ]) {
      expect(targets).toContain(t);
    }
  });

  it('sets GELDAR_NF_TELEMETRY on, the ledger pin from NF_LEDGER_SHA256, and the constant agent pin', () => {
    const env = on.services.neoforge?.environment ?? {};
    expect(env.GELDAR_NF_TELEMETRY).toBe('on');
    expect(env.GELDAR_NF_LEDGER_SHA256).toBe(DUMMY_SHA);
    expect(env.GELDAR_NF_OTEL_AGENT_SHA256).toBe(AGENT_PIN);
  });

  it('repeats the neoforge image of the base file exactly', () => {
    expect(on.services.neoforge?.image).toBe(off.services.neoforge?.image);
  });
});
