// Tests for deploy/colo-public.sh (card C2-07l: install per site). The script runs under bash with a fake `docker` on PATH that records
// its argv; no real docker, Caddy or network is used. bash is Git for Windows' bash on a Windows desktop and bash
// elsewhere; GELDAR_TEST_BASH overrides both.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(DEPLOY, 'colo-public.sh');
const IMPORT = 'import /config/geldar/*.caddy';
const CADDYFILE = 'other.example.invalid {\n\trespond 200\n}\n';

function findBash(): string {
  if (process.env.GELDAR_TEST_BASH) return process.env.GELDAR_TEST_BASH;
  if (process.platform !== 'win32') return 'bash';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (p): p is string => Boolean(p),
  );
  return roots.map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => existsSync(p)) ?? 'bash';
}
const BASH = findBash();

// Each test starts several bash processes; 60 s is a bound for real work under full-suite load, not a retry.
vi.setConfig({ testTimeout: 60_000 });

// The fake docker: records its argv, and fails `caddy validate` while $FAKE_VALIDATE_FAIL names an existing file.
const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"caddy validate"*) if [ -f "$FAKE_VALIDATE_FAIL" ]; then exit 1; fi ;;
esac
exit 0
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Rig {
  root: string;
  env: Record<string, string>;
  caddyfile: string;
  geldar: string;
  calls: () => string[];
  failValidate: (on: boolean) => void;
  run: (args: string[], over?: Record<string, string>) => { status: number | null; out: string };
}

const DEFAULT_ENV = [
  'GELDAR_DOMAIN=geldar.example.invalid',
  'GELDAR_MAP_UPSTREAM=127.0.0.1:8100',
  'GELDAR_GLASS_UPSTREAM=127.0.0.1:8101',
  'GELDAR_MCP_UPSTREAM=127.0.0.1:8102',
].join('\n');

function rig(envFile = DEFAULT_ENV): Rig {
  const root = mkdtempSync(join(tmpdir(), 'geldar-public-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), DOCKER_SHIM);
  chmodSync(join(bin, 'docker'), 0o755);
  const cfg = join(root, 'cfg');
  mkdirSync(cfg);
  const caddyfile = join(cfg, 'Caddyfile');
  writeFileSync(caddyfile, CADDYFILE);
  const envPath = join(root, 'public.env');
  writeFileSync(envPath, `${envFile}\n`);
  const callsLog = join(root, 'calls.log');
  writeFileSync(callsLog, '');
  const flag = join(root, 'validate-fails');
  const env = {
    GELDAR_CADDY_CONTAINER: 'fake-caddy',
    GELDAR_CADDY_CONFIG_DIR: cfg,
    GELDAR_CADDY_FILE: caddyfile,
    GELDAR_PUBLIC_ENV: envPath,
    DOCKER_CALLS_LOG: callsLog,
    FAKE_VALIDATE_FAIL: flag,
    GELDAR_STATE_DIR: join(root, 'state'),
    GELDAR_GLASS_TRUSTED_PROXIES: '192.0.2.1',
    GELDAR_MCP_TRUSTED_PROXIES: '192.0.2.1',
  };
  return {
    root,
    env,
    caddyfile,
    geldar: join(cfg, 'geldar'),
    calls: () => readFileSync(callsLog, 'utf8').split('\n').filter(Boolean),
    failValidate: (on) => {
      if (on) writeFileSync(flag, 'x');
      else rmSync(flag, { force: true });
    },
    run: (args, over = {}) => {
      const r = spawnSync(BASH, [SCRIPT, ...args], {
        encoding: 'utf8',
        timeout: 50_000,
        env: {
          ...process.env,
          ...env,
          ...over,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        },
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

const importCount = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l === IMPORT).length;

const live = (r: Rig, s: string) => existsSync(join(r.geldar, `${s}.caddy`));
const read = (r: Rig, s: string) => readFileSync(join(r.geldar, `${s}.caddy`), 'utf8');

describe('colo-public.sh install <site...>', () => {
  it('install mcp on a fresh dir writes only mcp; glass and map stay absent', () => {
    const r = rig();
    const res = r.run(['install', 'mcp']);
    expect(res.status).toBe(0);
    expect(live(r, 'mcp')).toBe(true);
    expect(read(r, 'mcp')).toContain('reverse_proxy 127.0.0.1:8102');
    expect(live(r, 'glass')).toBe(false);
    expect(live(r, 'map')).toBe(false);
    expect(readdirSync(join(r.geldar, 'store')).sort()).toEqual(['mcp-off.caddy', 'mcp.caddy']);
    expect(importCount(r.caddyfile)).toBe(1);
    const st = r.run(['status']).out;
    expect(st).toContain('mcp: on');
    expect(st).toContain('glass: not installed');
    expect(st).toContain('map: not installed');
  });

  it('is idempotent when re-run', () => {
    const r = rig();
    r.run(['install', 'mcp']);
    const first = read(r, 'mcp');
    expect(r.run(['install', 'mcp']).status).toBe(0);
    expect(read(r, 'mcp')).toBe(first);
    expect(importCount(r.caddyfile)).toBe(1);
    expect(readdirSync(r.geldar).sort()).toEqual(['mcp.caddy', 'store']);
  });

  it('a later install glass leaves mcp live, and an off site stays off', () => {
    const r = rig();
    r.run(['install', 'mcp']);
    expect(r.run(['install', 'glass']).status).toBe(0);
    expect(live(r, 'mcp')).toBe(true);
    expect(live(r, 'glass')).toBe(true);
    expect(live(r, 'map')).toBe(false);
    r.run(['off', 'mcp']);
    const off = read(r, 'mcp');
    expect(r.run(['install', 'map']).status).toBe(0);
    expect(read(r, 'mcp')).toBe(off);
    expect(r.run(['status']).out).toContain('mcp: off');
  });

  it('refuses an unknown site and changes nothing', () => {
    const r = rig();
    const res = r.run(['install', 'mcp', 'bogus']);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain('unknown site: bogus');
    expect(existsSync(r.geldar)).toBe(false);
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
  });

  it('on validate failure restores the previous files and the Caddyfile', () => {
    const r = rig();
    r.run(['install', 'mcp']);
    const mcp = read(r, 'mcp');
    const caddy = readFileSync(r.caddyfile, 'utf8');
    r.failValidate(true);
    const res = r.run(['install', 'glass']);
    expect(res.status).not.toBe(0);
    expect(live(r, 'glass')).toBe(false);
    expect(read(r, 'mcp')).toBe(mcp);
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(caddy);
    expect(readdirSync(join(r.geldar, 'store')).sort()).toEqual(['mcp-off.caddy', 'mcp.caddy']);
    // fresh dir: failure leaves no geldar dir at all
    const f = rig();
    f.failValidate(true);
    expect(f.run(['install', 'mcp']).status).not.toBe(0);
    expect(existsSync(f.geldar)).toBe(false);
    expect(f.calls().some((c) => c.includes('caddy reload'))).toBe(false);
  });

  it('bare install still makes all three live, and the trusted-proxy refusal applies to a named install', () => {
    const r = rig();
    expect(r.run(['install']).status).toBe(0);
    expect(readdirSync(r.geldar).sort()).toEqual([
      'glass.caddy',
      'map.caddy',
      'mcp.caddy',
      'store',
    ]);
    const p = rig();
    const res = p.run(['install', 'mcp'], {
      GELDAR_MCP_TRUSTED_PROXIES: '',
      GELDAR_GLASS_TRUSTED_PROXIES: '',
    });
    expect(res.status).not.toBe(0);
    expect(existsSync(p.geldar)).toBe(false);
  });

  it('a named install needs only the named sites upstreams in the env file', () => {
    const r = rig('GELDAR_DOMAIN=geldar.example.invalid\nGELDAR_MCP_UPSTREAM=127.0.0.1:8102');
    expect(r.run(['install', 'mcp']).status).toBe(0);
    expect(r.run(['install']).status).not.toBe(0);
  });
});
