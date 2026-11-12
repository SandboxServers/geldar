// Tests for the restart mode of deploy/colo-public.sh (card C2-07q, owner ruling R39: the shared Caddy has its admin API
// off, so it is restarted, not reloaded) and for the optional register upstream. A fake `docker` records its argv.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = join(fileURLToPath(new URL('..', import.meta.url)), 'colo-public.sh');
const CADDYFILE = 'other.example.invalid {\n\trespond 200\n}\n';
const NOTE =
  'colo-public: files installed and validated; RESTART board-proxy once to apply (docker restart fake-caddy)';

function findBash(): string {
  if (process.env.GELDAR_TEST_BASH) return process.env.GELDAR_TEST_BASH;
  if (process.platform !== 'win32') return 'bash';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (p): p is string => Boolean(p),
  );
  return roots.map((r) => join(r, 'Git', 'bin', 'bash.exe')).find((p) => existsSync(p)) ?? 'bash';
}
const BASH = findBash();
vi.setConfig({ testTimeout: 60_000 });

const SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"caddy validate"*) if [ -f "$FAKE_VALIDATE_FAIL" ]; then exit 1; fi ;;
  inspect*) echo true ;;
esac
exit 0
`;

const BASE_ENV = [
  'GELDAR_DOMAIN=geldar.example.invalid',
  'GELDAR_MAP_UPSTREAM=127.0.0.1:8100',
  'GELDAR_GLASS_UPSTREAM=127.0.0.1:8101',
  'GELDAR_MCP_UPSTREAM=127.0.0.1:8102',
];
const REGISTER = 'GELDAR_REGISTER_UPSTREAM=127.0.0.1:8103';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function rig(envLines: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'geldar-restart-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), SHIM);
  chmodSync(join(bin, 'docker'), 0o755);
  const cfg = join(root, 'cfg');
  mkdirSync(cfg);
  const caddyfile = join(cfg, 'Caddyfile');
  writeFileSync(caddyfile, CADDYFILE);
  writeFileSync(join(root, 'public.env'), `${envLines.join('\n')}\n`);
  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  const flag = join(root, 'validate-fails');
  const env = {
    GELDAR_CADDY_CONTAINER: 'fake-caddy',
    GELDAR_CADDY_CONFIG_DIR: cfg,
    GELDAR_CADDY_FILE: caddyfile,
    GELDAR_PUBLIC_ENV: join(root, 'public.env'),
    DOCKER_CALLS_LOG: log,
    FAKE_VALIDATE_FAIL: flag,
    GELDAR_STATE_DIR: join(root, 'state'),
    GELDAR_GLASS_TRUSTED_PROXIES: '192.0.2.1',
    GELDAR_MCP_TRUSTED_PROXIES: '192.0.2.1',
  };
  return {
    caddyfile,
    geldar: join(cfg, 'geldar'),
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    failValidate: () => writeFileSync(flag, 'x'),
    run: (args: string[], over: Record<string, string> = {}) => {
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

const RESTART = { GELDAR_PUBLIC_APPLY: 'restart' };

describe('colo-public.sh restart mode (R39)', () => {
  it('validates, never reloads, never restarts without the OK, and ends with the restart note', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    const res = r.run(['install'], RESTART);
    expect(res.status).toBe(0);
    expect(res.out.trimEnd().split('\n').at(-1)).toBe(`colo: ${NOTE}`);
    const calls = r.calls();
    expect(calls.some((c) => c.includes('caddy validate'))).toBe(true);
    expect(calls.some((c) => c.includes('caddy reload'))).toBe(false);
    expect(calls.some((c) => c.startsWith('restart'))).toBe(false);
    expect(readFileSync(join(r.geldar, 'map.caddy'), 'utf8')).toContain('map.geldar');
  });

  it('GELDAR_PUBLIC_RESTART_OK other than 1 does not restart', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    r.run(['install'], { ...RESTART, GELDAR_PUBLIC_RESTART_OK: 'yes' });
    expect(r.calls().some((c) => c.startsWith('restart'))).toBe(false);
  });

  it('restarts exactly once with GELDAR_PUBLIC_RESTART_OK=1, after validate, and checks it came back', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    const res = r.run(['install'], { ...RESTART, GELDAR_PUBLIC_RESTART_OK: '1' });
    expect(res.status).toBe(0);
    const calls = r.calls();
    expect(calls.filter((c) => c.startsWith('restart'))).toEqual(['restart fake-caddy']);
    expect(calls.some((c) => c.includes('caddy reload'))).toBe(false);
    const at = calls.indexOf('restart fake-caddy');
    expect(calls.slice(0, at).some((c) => c.includes('caddy validate'))).toBe(true);
    expect(calls.slice(at).some((c) => c.startsWith('inspect'))).toBe(true);
    expect(calls.slice(at).some((c) => c.includes('caddy validate'))).toBe(true);
    expect(res.out).not.toContain('RESTART board-proxy once');
  });

  it('on validate failure restores the Caddyfile and the previous site files byte for byte, exits non-zero, no restart', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    expect(r.run(['install'], RESTART).status).toBe(0);
    const before = readFileSync(join(r.geldar, 'glass.caddy'));
    const caddyBefore = readFileSync(r.caddyfile);
    writeFileSync(
      join(r.geldar, '..', '..', 'public.env'),
      `${[...BASE_ENV, REGISTER].join('\n').replace('8101', '8201')}\n`,
    );
    r.failValidate();
    const res = r.run(['install'], { ...RESTART, GELDAR_PUBLIC_RESTART_OK: '1' });
    expect(res.status).not.toBe(0);
    expect(readFileSync(join(r.geldar, 'glass.caddy')).equals(before)).toBe(true);
    expect(readFileSync(r.caddyfile).equals(caddyBefore)).toBe(true);
    expect(r.calls().some((c) => c.startsWith('restart'))).toBe(false);
  });

  it('none skips reload and restart', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    const res = r.run(['install'], { GELDAR_PUBLIC_APPLY: 'none', GELDAR_PUBLIC_RESTART_OK: '1' });
    expect(res.status).toBe(0);
    expect(r.calls().every((c) => c.includes('caddy validate'))).toBe(true);
  });

  it('the default apply mode still reloads', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    expect(r.run(['install']).status).toBe(0);
    expect(r.calls().some((c) => c.includes('caddy reload'))).toBe(true);
  });
});

describe('colo-public.sh optional register upstream', () => {
  it('renders a 503 for the register paths when it is unset', () => {
    const r = rig(BASE_ENV);
    expect(r.run(['install']).status).toBe(0);
    const glass = readFileSync(join(r.geldar, 'glass.caddy'), 'utf8');
    expect(glass).toContain(
      'handle @register {\n\t\trespond "the register service is not deployed" 503\n\t}',
    );
    expect(glass).not.toContain('register-proxy');
    expect(glass).not.toContain('{$');
    expect(glass).toContain('@register path /register /register/* /roster /roster/*');
    expect(glass).toContain('X-Content-Type-Options nosniff');
  });

  it('proxies to it as before when it is set', () => {
    const r = rig([...BASE_ENV, REGISTER]);
    expect(r.run(['install']).status).toBe(0);
    const glass = readFileSync(join(r.geldar, 'glass.caddy'), 'utf8');
    expect(glass).toContain('reverse_proxy 127.0.0.1:8103');
    expect(glass).not.toContain('is not deployed');
  });
});
