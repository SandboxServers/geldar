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

  it('holds no secret value: the client secret is a file name in the runbook only', () => {
    const runbook = read('docs/runbooks/kino.md');
    expect(runbook).toContain('REGISTER_MS_CLIENT_SECRET_FILE');
    expect(`${colo}${caddy}${runbook}`).not.toMatch(/client_secret\s*[:=]\s*\S{12,}/i);
  });
});
