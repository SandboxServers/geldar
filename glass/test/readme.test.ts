/**
 * The README states the security headers and the Host rule. These tests read it and compare it with
 * the code, so a change to either side fails here until both are updated.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../src/http.ts';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');

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

  it('states the loopback-only, no-auth Phase 0 position and the 421 Host rule', () => {
    expect(README).toMatch(/\*\*loopback only\*\*/);
    expect(README).toMatch(/no authentication in Phase 0/);
    expect(README).toContain('421 Misdirected');
    expect(README).toContain('DNS rebinding');
  });
});
