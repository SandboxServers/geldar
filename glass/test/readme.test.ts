/**
 * The README states the security headers and the Host rule. These tests read it and compare it with
 * the code, so a change to either side fails here until both are updated.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../src/http.ts';

const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'),
  'utf8',
);

describe('the Glass README', () => {
  it('quotes the Content-Security-Policy string the code sends, exactly', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    expect(csp).toBeDefined();
    expect(README).toContain(`- \`Content-Security-Policy: ${csp}\``);
  });

  it('lists every security header the code sends', () => {
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(README, name).toContain(`\`${name}:`);
    }
  });

  it('states the public-behind-Caddy position, the Host rule and the Caddy peer setting', () => {
    expect(README).toMatch(/\*\*public behind Caddy\*\*/);
    expect(README).toMatch(/loopback only and has no authentication/);
    expect(README).toContain('421 Misdirected');
    expect(README).toContain('DNS rebinding');
    expect(README).toContain('Host: localhost');
  });

  it('lists every rate, delay, sovereign, proxy and kill-switch variable, and the fast switch', () => {
    for (const name of [
      'GELDAR_GLASS_RATE_PER_MINUTE',
      'GELDAR_GLASS_RATE_BURST',
      'GELDAR_GLASS_RATE_MAX_CLIENTS',
      'GELDAR_GLASS_DELAY_SECONDS',
      'GELDAR_GLASS_SHOW_LIVING_SOVEREIGN',
      'GELDAR_GLASS_TRUSTED_PROXIES',
      'GELDAR_GLASS_ENABLED',
    ]) {
      expect(README, name).toContain(`\`${name}\``);
    }
    expect(README).toMatch(/\| `GELDAR_GLASS_DELAY_SECONDS` \| `60` \|/);
    expect(README).toContain('read once at start');
    expect(README).toContain('glass-off.caddy');
    expect(README).toContain("Set it to Caddy's peer address");
  });

  it('does not list /api/stats, allows HEAD, and says CI runs the IT cases', () => {
    expect(README).not.toContain('/api/stats');
    expect(README).toContain('Allow: GET, HEAD');
    expect(README).toMatch(/CI runs\s+these cases in the `integration` job/);
  });
});
