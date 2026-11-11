// Tests for deploy/colo-public.sh (card C2-07b). The script runs under bash with a fake `docker` on PATH that records
// its argv; no real docker, Caddy or network is used. bash is Git for Windows' bash on a Windows desktop and bash
// elsewhere; GELDAR_TEST_BASH overrides both.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  return (
    roots.map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => existsSync(p)) ?? 'bash'
  );
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

describe('colo-public.sh install', () => {
  it('is idempotent: one import line after two runs, files rendered with no placeholder', () => {
    const r = rig();
    expect(r.run(['install']).status).toBe(0);
    expect(r.run(['install']).status).toBe(0);
    expect(importCount(r.caddyfile)).toBe(1);
    const map = readFileSync(join(r.geldar, 'map.caddy'), 'utf8');
    expect(map).toContain('map.geldar.example.invalid');
    expect(map).toContain('reverse_proxy 127.0.0.1:8100');
    for (const f of readdirSync(r.geldar).filter((n) => n.endsWith('.caddy'))) {
      expect(readFileSync(join(r.geldar, f), 'utf8')).not.toContain('{$');
    }
    expect(readdirSync(r.geldar).sort()).toEqual(['glass.caddy', 'map.caddy', 'mcp.caddy', 'store']);
  });

  it('restores the Caddyfile byte for byte and removes the dir when validate fails', () => {
    const r = rig();
    r.failValidate(true);
    const res = r.run(['install']);
    expect(res.status).not.toBe(0);
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
    expect(existsSync(r.geldar)).toBe(false);
    expect(r.calls().some((c) => c.includes('caddy reload'))).toBe(false);
  });

  it('only validates and reloads: never restart, up, recreate, run or start', () => {
    const r = rig();
    r.run(['install']);
    r.run(['off', 'all']);
    r.run(['on', 'map']);
    r.run(['remove']);
    const calls = r.calls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c).toMatch(
        /^exec fake-caddy caddy (validate|reload) --config \/etc\/caddy\/Caddyfile$/,
      );
    }
    expect(calls.some((c) => c.includes('caddy reload'))).toBe(true);
  });

  it('dry run changes nothing and runs no docker command', () => {
    const r = rig();
    const res = r.run(['install'], { DEPLOY_DRY_RUN: '1' });
    expect(res.status).toBe(0);
    expect(res.out).toContain('dry-run');
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
    expect(existsSync(r.geldar)).toBe(false);
    expect(readdirSync(join(r.root, 'cfg'))).toEqual(['Caddyfile']);
    expect(r.calls()).toEqual([]);
  });
});

describe('colo-public.sh off, on and remove', () => {
  it('swaps a site for its off twin and back, and off all covers every site', () => {
    const r = rig();
    r.run(['install']);
    const live = readFileSync(join(r.geldar, 'map.caddy'), 'utf8');
    expect(r.run(['off', 'map']).status).toBe(0);
    expect(readFileSync(join(r.geldar, 'map.caddy'), 'utf8')).toContain('respond 503');
    expect(readFileSync(join(r.geldar, 'glass.caddy'), 'utf8')).not.toContain('respond 503');
    expect(r.run(['status']).out).toMatch(/map: off[\s\S]*glass: on/);
    expect(r.run(['on', 'map']).status).toBe(0);
    expect(readFileSync(join(r.geldar, 'map.caddy'), 'utf8')).toBe(live);
    r.run(['off', 'all']);
    for (const s of ['map', 'glass', 'mcp']) {
      expect(readFileSync(join(r.geldar, `${s}.caddy`), 'utf8')).toContain('respond 503');
    }
  });

  it('puts the old file back when validate fails on off', () => {
    const r = rig();
    r.run(['install']);
    const live = readFileSync(join(r.geldar, 'mcp.caddy'), 'utf8');
    r.failValidate(true);
    expect(r.run(['off', 'mcp']).status).not.toBe(0);
    expect(readFileSync(join(r.geldar, 'mcp.caddy'), 'utf8')).toBe(live);
  });

  it('remove restores the Caddyfile and deletes the dir; status reports it', () => {
    const r = rig();
    r.run(['install']);
    expect(r.run(['status']).out).toContain('import line: present');
    expect(r.run(['remove']).status).toBe(0);
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
    expect(existsSync(r.geldar)).toBe(false);
    expect(r.run(['status']).out).toContain('import line: absent');
  });

  it('remove keeps everything when validate fails', () => {
    const r = rig();
    r.run(['install']);
    const withImport = readFileSync(r.caddyfile, 'utf8');
    r.failValidate(true);
    expect(r.run(['remove']).status).not.toBe(0);
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(withImport);
    expect(existsSync(r.geldar)).toBe(true);
  });
});

describe('colo-public.sh refusals', () => {
  it('refuses when a required environment variable is missing', () => {
    for (const name of ['GELDAR_CADDY_CONTAINER', 'GELDAR_CADDY_FILE', 'GELDAR_PUBLIC_ENV']) {
      const r = rig();
      const res = r.run(['install'], { [name]: '' });
      expect(res.status).not.toBe(0);
      expect(res.out).toContain(name);
      expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
      expect(existsSync(r.geldar)).toBe(false);
    }
  });

  it('refuses when an env-file key is missing', () => {
    const r = rig(DEFAULT_ENV.replace('GELDAR_MCP_UPSTREAM=127.0.0.1:8102', ''));
    const res = r.run(['install']);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain('GELDAR_MCP_UPSTREAM');
    expect(existsSync(r.geldar)).toBe(false);
  });

  it('refuses a rendered file that still has a placeholder', () => {
    const r = rig();
    const src = join(r.root, 'src');
    mkdirSync(src);
    for (const s of ['map', 'glass', 'mcp']) {
      for (const f of [`${s}.caddy`, `${s}-off.caddy`]) {
        writeFileSync(join(src, f), readFileSync(join(DEPLOY, 'caddy', f)));
      }
    }
    writeFileSync(
      join(src, 'map.caddy'),
      'map.{$GELDAR_DOMAIN} {\n\treverse_proxy {$GELDAR_MAP_UPSTREAM} {$GELDAR_EXTRA}\n}\n',
    );
    const res = r.run(['install'], { GELDAR_PUBLIC_SRC: src });
    expect(res.status).not.toBe(0);
    expect(res.out).toContain('unrendered placeholder');
    expect(readFileSync(r.caddyfile, 'utf8')).toBe(CADDYFILE);
    expect(existsSync(r.geldar)).toBe(false);
  });

  it.each(['10.0.0.5:8100', '0.0.0.0:8100', 'host.example.invalid:8100', '127.0.0.1'])(
    'refuses a non-loopback upstream (%s)',
    (up) => {
      const r = rig(DEFAULT_ENV.replace('127.0.0.1:8100', up));
      const res = r.run(['install']);
      expect(res.status).not.toBe(0);
      expect(res.out).toContain('loopback');
      expect(existsSync(r.geldar)).toBe(false);
      expect(r.calls()).toEqual([]);
    },
  );
});
