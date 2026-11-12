import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');

describe('Kino deploy wiring', () => {
  const colo = read('compose/colo.yml');
  const caddy = read('deploy/caddy/glass.caddy');

  it('defaults Kino to off in compose', () => {
    expect(colo).toContain('GELDAR_KINO_ENABLED: "${GELDAR_KINO_ENABLED:-0}"');
  });

  it('gates the Caddy Kino route on the env flag, defaulting to off', () => {
    expect(caddy).toContain('{$GELDAR_KINO_ENABLED:0} == 1');
    expect(caddy).toContain("path('/kino', '/kino/*')");
  });

  it('forwards the WebSocket unbuffered through the TLS site, with the address header set by Caddy', () => {
    const block = caddy.slice(caddy.indexOf('handle @kino'), caddy.indexOf('handle @register {'));
    expect(block).toContain('reverse_proxy {$GELDAR_GLASS_UPSTREAM}');
    expect(block).toContain('flush_interval -1');
    expect(block).toContain('header_up x-geldar-client-ip {remote_host}');
    expect(caddy.startsWith('# Glass')).toBe(true);
    expect(caddy).toContain('glass.{$GELDAR_DOMAIN} {');
    expect(caddy).not.toMatch(/http:\/\//);
  });

  const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
  const render = (files: string[], env: Record<string, string>) =>
    spawnSync(
      'docker',
      [
        'compose',
        ...files.flatMap((f) => ['-f', `${ROOT}compose/${f}`]),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: { ...process.env, GELDAR_KINO_PUBLIC_ORIGIN: '', ...env } },
    );

  it.runIf(hasDocker)(
    'requires GELDAR_KINO_PUBLIC_ORIGIN when the Kino overlay is merged, and passes it to Glass',
    () => {
      const files = ['colo.yml', 'colo-kino.yml'];
      const missing = render(files, {});
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('GELDAR_KINO_PUBLIC_ORIGIN');
      const ok = render(files, { GELDAR_KINO_PUBLIC_ORIGIN: 'https://glass.example.test' });
      expect(ok.status).toBe(0);
      expect(JSON.parse(ok.stdout).services.glass.environment.GELDAR_KINO_ALLOWED_ORIGINS).toBe(
        'https://glass.example.test',
      );
      // The base file alone does not need the variable.
      expect(render(['colo.yml'], {}).status).toBe(0);
    },
  );

  it('sets the Glass shard to colo in the Kino overlay', () => {
    expect(read('compose/colo-kino.yml')).toMatch(/^ {6}GELDAR_SHARD: colo$/m);
  });

  it.runIf(hasDocker)('gives Glass shard colo in the merged Colo config', () => {
    const ok = render(['colo.yml', 'colo-kino.yml'], {
      GELDAR_KINO_PUBLIC_ORIGIN: 'https://glass.example.test',
      GELDAR_SHARD: '',
    });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).services.glass.environment.GELDAR_SHARD).toBe('colo');
  });

  it('serves the textures read-only from the map upstream at /kino/tex/*, behind the Kino switch', () => {
    const start = caddy.indexOf('@kino_tex');
    const block = caddy.slice(start, caddy.indexOf('@kino_tex_other'));
    expect(block).toContain('{$GELDAR_KINO_ENABLED:0} == 1');
    expect(block).toContain("path('/kino/tex/maps/*/textures.json')");
    expect(block).not.toContain("path('/kino/tex/*')");
    expect(block).toContain('header_up -Cookie');
    expect(block).toContain('header_up -Authorization');
    expect(block).toContain('header_down -Set-Cookie');
    expect(block).toContain("Content-Security-Policy \"default-src 'none'");
    expect(block).toContain('uri strip_prefix /kino/tex');
    expect(block).toContain('reverse_proxy {$GELDAR_MAP_UPSTREAM}');
    expect(block).toContain("'*/live/*'");
    expect(block).not.toContain('{$GELDAR_GLASS_UPSTREAM}');
    // Every method but GET and HEAD is refused (405) before any handle for a non-register path.
    expect(caddy.indexOf('not method GET HEAD')).toBeLessThan(start);
    expect(caddy.indexOf('respond 405')).toBeLessThan(start);
  });

  it('keeps the NATS monitor off the colo network: none in the base, loopback only in the overlay', () => {
    const base = read('compose/colo.yml');
    const natsBase = base.slice(base.indexOf('\n  nats:'), base.indexOf('nats-data:/data'));
    expect(natsBase).not.toMatch(/"-m"/);
    expect(base).not.toContain('localhost:8222');
    const overlay = read('compose/nats-auth.yml');
    expect(overlay).not.toMatch(/"-m"/);
    expect(overlay).not.toMatch(/^\s+healthcheck:/m);
    expect(read('geldar.ps1')).toContain(`'http: "127.0.0.1:8222"'`);
  });
  it('does not proxy any other path under /kino/tex/: it answers 404 before the Glass proxy', () => {
    const other = caddy.slice(caddy.indexOf('@kino_tex_other'), caddy.indexOf('@kino expression'));
    expect(other).toContain("path('/kino/tex', '/kino/tex/*')");
    expect(other).toContain('respond 404');
    expect(other).not.toContain('reverse_proxy');
    // The 404 handle sits before the Glass /kino handle, and only the textures.json handle proxies the map upstream.
    expect(caddy.indexOf('handle @kino_tex_other')).toBeLessThan(caddy.indexOf('handle @kino {'));
    expect(caddy.match(/reverse_proxy \{\$GELDAR_MAP_UPSTREAM\}/g)?.length).toBe(1);
  });

  it('probes only the NATS client port, never the monitor, so an old nats-auth.conf stays healthy', () => {
    const probe = (text: string) => {
      const m = text.slice(text.indexOf('\n  nats:')).match(/healthcheck:\s+test: (\[[^\]]*\])/);
      return m?.[1] ?? '';
    };
    expect(probe(read('compose/colo.yml'))).toContain('"4222"');
    expect(read('compose/nats-auth.yml')).not.toMatch(/^\s+healthcheck:/m);
    for (const files of [['colo.yml'], ['colo.yml', 'nats-auth.yml']]) {
      if (!hasDocker) continue;
      const r = render(files, {});
      expect(r.status).toBe(0);
      const hc = JSON.stringify(JSON.parse(r.stdout).services.nats.healthcheck.test);
      expect(hc).not.toContain('8222');
      expect(hc).toContain('4222');
    }
    expect(read('deploy/test/fixtures/colo-merged-config.yml')).not.toContain('8222');
  });

  it('wires the Glass session key only through the optional session overlay', () => {
    expect(colo).not.toContain('GELDAR_GLASS_SESSION_KEY_FILE');
    expect(read('compose/colo-kino.yml')).not.toContain('SESSION_KEY');
    const overlay = read('compose/colo-kino-session.yml');
    expect(overlay).toContain('GELDAR_GLASS_SESSION_KEY_FILE: /run/secrets/register-session-key');
    // The secret is declared once, in colo.yml (the register service needs it there); the overlay only mounts it.
    expect(overlay).not.toMatch(/^secrets:/m);
    expect(colo).toContain('file: ${GELDAR_SECRETS_DIR:-./secrets}/register-session-key.txt');
    if (hasDocker) {
      const env = { GELDAR_KINO_PUBLIC_ORIGIN: 'https://glass.example.test' };
      const without = JSON.parse(render(['colo.yml', 'colo-kino.yml'], env).stdout);
      expect(without.services.glass.environment.GELDAR_GLASS_SESSION_KEY_FILE).toBeUndefined();
      const withKey = render(['colo.yml', 'colo-kino.yml', 'colo-kino-session.yml'], env);
      expect(withKey.status).toBe(0);
      expect(
        JSON.parse(withKey.stdout).services.glass.environment.GELDAR_GLASS_SESSION_KEY_FILE,
      ).toBe('/run/secrets/register-session-key');
    }
  });

  it('holds no secret value: the client secret is a file name in the runbook only', () => {
    const runbook = read('docs/runbooks/kino.md');
    expect(runbook).toContain('REGISTER_MS_CLIENT_SECRET_FILE');
    expect(`${colo}${caddy}${runbook}`).not.toMatch(/client_secret\s*[:=]\s*\S{12,}/i);
  });
});
