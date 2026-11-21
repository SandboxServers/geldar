/**
 * The sign-in link on the Thought Stream page. It is one plain same-origin anchor to the relative path
 * /register/ (Caddy sends /register* to the register service). It has no script, form, cookie, target or
 * tracking attribute, and the page keeps its read-only banner above it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PUBLIC = new URL('../public/', import.meta.url);
const HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const CSS = readFileSync(new URL('app.css', PUBLIC), 'utf8');

/** Every anchor on the page: its attributes and its text. */
function anchors(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<a\s([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: m[2] ?? '',
  }));
}

const SIGN_IN = anchors(HTML).filter((a) => a.text.trim() === 'Sign in / Register');

describe('the sign-in link on the Thought Stream page', () => {
  it('is exactly one anchor whose href is the relative path /register/ and nothing else', () => {
    expect(SIGN_IN).toHaveLength(1);
    expect(SIGN_IN[0]?.attrs).toBe('href="/register/"');
  });

  it('sits in its own paragraph with no form or script around it', () => {
    expect(HTML).toContain('<p class="account"><a href="/register/">Sign in / Register</a></p>');
    expect(HTML).not.toMatch(/href="https?:\/\/[^"]*register/);
  });

  it('comes after the read-only banner, which is still rendered', () => {
    expect(HTML).toContain('Read-only. For human observers only.');
    expect(HTML.indexOf('class="banner"')).toBeLessThan(HTML.indexOf('href="/register/"'));
  });

  it('has a touch target of at least 44px in the stylesheet', () => {
    expect(CSS).toMatch(/\.account a \{[^}]*min-height: 2\.75rem;/);
  });
});
