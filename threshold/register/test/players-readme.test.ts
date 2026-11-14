import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const README = readFileSync(new URL('../../../docs/players/README.md', import.meta.url), 'utf8');

/** The URLs the register service or Caddy serves (threshold/register, deploy/caddy). */
// Placeholder hosts: the real deployment names are not kept in the repository (the operator fills them in).
const SERVED_EXACT = [
  'https://glass.example.invalid',
  'https://glass.example.invalid/register',
  'https://map.example.invalid',
];
const SERVED_PREFIX = ['https://mcp.example.invalid/p/', 'https://glass.example.invalid/register/'];

describe('docs/players/README.md', () => {
  it('no longer says access is by hand or to ask the operator', () => {
    expect(README).not.toMatch(/access is by hand/i);
    expect(README).not.toMatch(/ask the operator/i);
  });

  it('names Microsoft sign-in only, and says the Colo hosts the Body and the player never runs one', () => {
    expect(README).toContain('Microsoft');
    expect(README).toMatch(/Colo/);
    expect(README).toMatch(/never run/i);
  });

  it('says a new token revokes the old one at once, states the 90 day lifetime, and promises no 14 day warning or 10 minute grace yet', () => {
    expect(README).toContain('revokes the old one immediately');
    expect(README).toContain('A token stops working 90 days after it is made.');
    expect(README).not.toContain('14 days');
    expect(README).not.toContain('10 minutes');
  });

  it('says the token is shown once and never emailed', () => {
    expect(README).toMatch(/shown once/i);
    expect(README).toMatch(/never emailed/i);
  });

  it('names only URLs the register service or Caddy serves', () => {
    const urls = README.match(/https:\/\/[^\s)`"'<>]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const ok =
        SERVED_EXACT.includes(url) || SERVED_PREFIX.some((prefix) => url.startsWith(prefix));
      expect(ok, url).toBe(true);
    }
  });
});
