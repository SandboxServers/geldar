/**
 * The scratch stack overlay (compose/opt-in/scratch.yml) and its script (deploy/scratch/scratch.sh). The overlay is parsed
 * with the yaml package, the !override tag as a custom tag, so the exact ports and limits are checked. The script's
 * gates and NATS rule run under sh with docker, uname, df and powershell.exe stubbed on PATH; those tests skip when no
 * sh is on PATH. Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, type Tag } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch.yml`, 'utf8');
const SCRIPT_PATH = `${ROOT}deploy/scratch/scratch.sh`;
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
const PHASE0_TEXT = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');

/** compose replaces the list under !override instead of appending to it; the parsed value is marked. */
const OVERRIDE: Tag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};

interface Service {
  ports?: { override: boolean; items: string[] } | string[];
  deploy?: { resources: { limits: { memory: string; cpus: string } } };
  memswap_limit?: string;
  restart?: string;
  labels?: Record<string, string>;
}
interface Overlay {
  services: Record<string, Service>;
  secrets: Record<string, { file: string }>;
}

const OVERLAY = parse(OVERLAY_TEXT, { customTags: [OVERRIDE] }) as Overlay;
const BASE = parse(PHASE0_TEXT) as { services: Record<string, { ports?: string[] }> };
const OVERLAY_SERVICES = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'];

/** The host port of a published mapping such as "127.0.0.1:5432:5432" (host is the second field from the end). */
function hostPort(mapping: string): number {
  const match = mapping.match(/(\d+):\d+$/);
  if (!match?.[1]) throw new Error(`no host port in ${mapping}`);
  return Number(match[1]);
}

describe('scratch overlay: ports', () => {
  it('replaces the ports of postgres, nats and velocity with exact loopback mappings', () => {
    expect(OVERLAY.services.postgres?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_PG_PORT:-15432}:5432`],
    });
    expect(OVERLAY.services.nats?.ports).toEqual({
      override: true,
      items: [
        `127.0.0.1:\${SCRATCH_NATS_PORT:-14222}:4222`,
        `127.0.0.1:\${SCRATCH_NATS_MON_PORT:-18222}:8222`,
      ],
    });
    expect(OVERLAY.services.velocity?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_MC_PORT:-35565}:25565`],
    });
  });

  it('gives paper and eventsink no ports key, so they publish nothing', () => {
    expect(OVERLAY.services.paper).not.toHaveProperty('ports');
    expect(OVERLAY.services.eventsink).not.toHaveProperty('ports');
  });

  it('uses the four defaults the runbook names, and none of them is a phase0 host port', () => {
    const defaults = [...OVERLAY_TEXT.matchAll(/\$\{SCRATCH_[A-Z_]+:-(\d+)\}/g)].map((m) =>
      Number(m[1]),
    );
    expect(defaults.sort((a, b) => a - b)).toEqual([14222, 15432, 18222, 35565]);
    const phase0Hosts = Object.values(BASE.services).flatMap((s) => (s.ports ?? []).map(hostPort));
    expect(phase0Hosts).toContain(5432);
    for (const port of defaults) expect(phase0Hosts).not.toContain(port);
  });

  it('binds every overlay mapping to 127.0.0.1 and no other address', () => {
    expect(OVERLAY_TEXT).not.toMatch(/0\.0\.0\.0/);
    const addresses = OVERLAY_TEXT.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(addresses.filter((address) => address !== '127.0.0.1')).toEqual([]);
    expect(OVERLAY_TEXT).not.toMatch(/container_name/);
  });
});

describe('scratch overlay: caps and secrets', () => {
  it.each(OVERLAY_SERVICES)(
    'caps %s, sets memswap to the memory cap, restart "no", and the label',
    (name) => {
      const service = OVERLAY.services[name];
      const limits = service?.deploy?.resources.limits;
      expect(limits?.memory).toMatch(/^\d+m$/);
      expect(limits?.cpus).toMatch(/^[\d.]+$/);
      expect(service?.memswap_limit).toBe(limits?.memory);
      expect(service?.restart).toBe('no');
      expect(service?.labels).toEqual({ 'geldar.scratch': 'true' });
    },
  );

  it('caps every service that phase0.yml defines, so a new service cannot run uncapped', () => {
    for (const name of Object.keys(BASE.services)) {
      expect(OVERLAY.services[name]?.deploy?.resources.limits.memory, name).toBeDefined();
    }
  });

  it('keeps the paper heap default at 2G and the paper cap at 3072m', () => {
    expect(OVERLAY_TEXT).toContain(`MEMORY: \${PAPER_MEMORY:-2G}`);
    expect(OVERLAY.services.paper?.deploy?.resources.limits.memory).toBe('3072m');
  });

  it('takes the postgres, rcon and forwarding secrets from the state directory only', () => {
    expect(OVERLAY.secrets.postgres?.file).toBe(
      `\${SCRATCH_SECRETS_DIR:?set by deploy/scratch/scratch.sh}/postgres.txt`,
    );
    expect(OVERLAY_TEXT).not.toContain('./secrets/');
  });
});

describe('scratch script: text', () => {
  it('tears down with -v, the local images and orphans, and never names /tmp', () => {
    expect(SCRIPT).toContain('down -v --rmi local --remove-orphans');
    expect(SCRIPT).not.toMatch(/TMPDIR|\/tmp/);
  });

  it('reads free disk on the Docker data root as well as the repo', () => {
    expect(SCRIPT).toContain('{{.DockerRootDir}}');
  });

  it('checks the NATS auth, then the gate, then the plugin jars, before compose up', () => {
    const up = SCRIPT.slice(SCRIPT.indexOf('do_up() {'), SCRIPT.indexOf('do_status() {'));
    const at = (needle: string) => up.indexOf(needle);
    expect(at('check_nats')).toBeGreaterThanOrEqual(0);
    expect(at('check_nats')).toBeLessThan(at('  gate'));
    expect(at('  gate')).toBeLessThan(at('check_plugins'));
    expect(at('check_plugins')).toBeLessThan(at('compose_run up'));
  });
});

const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null;

/** A bin dir with stubs: docker answers info and compose version; uname says non-Linux; df and powershell.exe print the
 * STUB_DISK_KB and STUB_RAM_KB values from the environment. Every docker call is appended to STUB_LOG. */
function stubs(): { base: string; env: Record<string, string>; log: string } {
  const base = mkdtempSync(join(tmpdir(), 'scratch-stub-'));
  const bin = join(base, 'bin');
  mkdirSync(bin);
  const log = join(base, 'docker.log');
  const files: Record<string, string> = {
    docker:
      '#!/bin/sh\necho "$*" >>"$STUB_LOG"\ncase "$*" in\n  *"version --short"*) echo 2.30.0 ;;\n  info*) echo /var/lib/docker ;;\nesac\nexit 0\n',
    uname: '#!/bin/sh\necho MINGW64_NT\n',
    'powershell.exe': '#!/bin/sh\necho "$STUB_RAM_KB"\n',
    df: '#!/bin/sh\necho Filesystem\necho "x 1 1 $STUB_DISK_KB 1% /"\n',
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(bin, name), text);
  const home = join(base, 'home');
  mkdirSync(home);
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    HOME: home,
    XDG_STATE_HOME: join(home, 'state'),
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    STUB_LOG: log,
    STUB_RAM_KB: '20000000',
    STUB_DISK_KB: '50000000',
  };
  return { base, env, log };
}

/** Runs the script with the stubs. Only the given environment is passed, so no SCRATCH_* variable leaks in. */
function runScript(
  args: string[],
  extra: Record<string, string> = {},
): { status: number | null; stderr: string; calls: string } {
  const s = stubs();
  try {
    const result = spawnSync(SH as string, [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      env: { ...s.env, ...extra },
    });
    const calls = existsSync(s.log) ? readFileSync(s.log, 'utf8') : '';
    return { status: result.status, stderr: result.stderr, calls };
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
}

describe.skipIf(!SH)('scratch script under sh', { timeout: 60_000 }, () => {
  it('up without NATS auth exits 2 and makes no docker call', () => {
    const run = runScript(['up']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('NATS auth is required');
    expect(run.calls).toBe('');
  });

  it('up with an auth dir missing one of the four files exits 2 and makes no docker call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scratch-auth-'));
    try {
      for (const f of ['nats-auth.conf', 'nats-paper.txt', 'nats-velocity.txt'])
        writeFileSync(join(dir, f), 'x');
      const run = runScript(['up'], { SCRATCH_NATS_AUTH_DIR: dir });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('nats-eventsink.txt');
      expect(run.calls).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('up with SCRATCH_NATS_OPEN=1 prints the open-NATS warning and does not refuse', () => {
    const run = runScript(['up'], { SCRATCH_NATS_OPEN: '1' });
    expect(run.stderr).toContain('WARNING: NATS IS OPEN');
    expect(run.status).not.toBe(2);
  });

  it('up exits 3 before any compose call when the RAM figure is not a number', () => {
    const run = runScript(['up'], { SCRATCH_NATS_OPEN: '1', STUB_RAM_KB: 'abc' });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('could not read free RAM or free disk as numbers');
    expect(run.calls).not.toContain('-p scratch-');
  });

  it('up exits 3 before any compose call when the disk figure is not a number', () => {
    const run = runScript(['up'], { SCRATCH_NATS_OPEN: '1', STUB_DISK_KB: '1\n2' });
    expect(run.status).toBe(3);
    expect(run.calls).not.toContain('-p scratch-');
  });

  it('up exits 3 when free RAM is below 10 GB', () => {
    const run = runScript(['up'], { SCRATCH_NATS_OPEN: '1', STUB_RAM_KB: '10485759' });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('gate failed');
    expect(run.calls).not.toContain('-p scratch-');
  });

  it('refuses a suffix outside [a-z0-9]{1,8} with exit 2 and no docker call', () => {
    for (const suffix of ['A b', '../x', 'toolongsuffix']) {
      const run = runScript(['up', suffix], { SCRATCH_NATS_OPEN: '1' });
      expect(run.status, suffix).toBe(2);
      expect(run.calls, suffix).toBe('');
    }
  });

  it('down runs compose down with the new flags and removes nothing outside the state directory', () => {
    const run = runScript(['down']);
    expect(run.calls).toContain('down -v --rmi local --remove-orphans');
    expect(run.status).toBe(0);
  });
});
