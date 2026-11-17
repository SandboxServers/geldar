import { describe, expect, it } from 'vitest';
import { REDACTED as R, redactContent, scrubText } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const tk = ['to', 'ken'].join('');
const MiB = 1 << 20;

describe('a quoted credential value with escapes (step 1)', () => {
  const value = (v: string): string => `Zq9x${v}K2mP7vL4Ab`;
  it.each([
    ['an escaped quote', '"'],
    ['two escaped quotes', '""'],
    ['an escaped backslash then a quote', '\\"'],
    ['a backslash run then a quote', '\\\\\\"'],
    ['a newline and a tab', '\n\t'],
    ['a single quote', "'"],
  ])('hides all of a JSON value with %s', (_n, middle) => {
    for (const key of [pw, tk, 'api_key']) {
      const json = JSON.stringify({ [key]: value(middle), after: 'ok' });
      expect(scrubText(json)).toBe(JSON.stringify({ [key]: R, after: 'ok' }));
    }
  });

  it('hides all of a value inside a JSON string, and inside that again', () => {
    const inner = JSON.stringify({ [pw]: value('"'), after: 'ok' });
    const one = scrubText(JSON.stringify({ args: inner }));
    expect(one).toBe(JSON.stringify({ args: JSON.stringify({ [pw]: R, after: 'ok' }) }));
    const two = scrubText(JSON.stringify({ args: JSON.stringify({ args: inner }) }));
    expect(two).toBe(
      JSON.stringify({ args: JSON.stringify({ args: JSON.stringify({ [pw]: R, after: 'ok' }) }) }),
    );
  });

  it('closes a value that ends in a backslash', () => {
    for (const tail of ['\\', '\\\\', 'a\\']) {
      const json = JSON.stringify({ [tk]: `Zq9x${tail}`, after: 'ok' });
      expect(scrubText(json)).toBe(JSON.stringify({ [tk]: R, after: 'ok' }));
      const nested = JSON.stringify({ args: json });
      expect(scrubText(nested)).toBe(JSON.stringify({ args: JSON.stringify({ [tk]: R, after: 'ok' }) }));
    }
  });

  it('hides a single-quoted value with an escaped quote', () => {
    expect(scrubText(`{'${pw}': 'Zq9x\\'K2mP7vL4Ab', 'n': 1}`)).toBe(`{'${pw}': '${R}', 'n': 1}`);
    expect(scrubText(`${pw}='Zq9x\\'K2mP7vL4Ab' next`)).toBe(`${pw}='${R}' next`);
  });

  it('hides a double-quoted value after = with an escaped quote', () => {
    expect(scrubText(`${pw}="Zq9x\\"K2mP7vL4Ab" next`)).toBe(`${pw}="${R}" next`);
  });

  it('reaches the same through redactContent for a string field', () => {
    const out = redactContent({ log: JSON.stringify({ [pw]: value('"') }) }) as { log: string };
    expect(out.log).toBe(JSON.stringify({ [pw]: R }));
  });

  it('is linear on 1 MiB of escaped quotes after a credential key', () => {
    const run = '\\"'.repeat(MiB / 2);
    const text = `{"${pw}":"${run}`;
    const start = performance.now();
    const out = scrubText(text);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(out.length).toBeLessThan(text.length + 64);
  });

  it('is linear on a credential key repeated with escaped quotes', () => {
    const text = `{"${pw}":"\\"`.repeat(MiB / 16);
    const start = performance.now();
    scrubText(text);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
