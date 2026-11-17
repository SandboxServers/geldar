import { describe, expect, it } from 'vitest';
import { REDACTED as R, scrubText } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const tk = ['to', 'ken'].join('');
const MiB = 1 << 20;

describe('an unquoted value that contains a delimiter (step 4)', () => {
  it.each([',', ';', '&', ')', '}'])('hides password=Zq9x%sK2mP7vL4Ab', (d) => {
    expect(scrubText(`${pw}=Zq9x${d}K2mP7vL4Ab`)).toBe(`${pw}=${R}`);
    expect(scrubText(`${pw}: Zq9x${d}K2mP7vL4Ab done`)).toBe(`${pw}: ${R} done`);
  });

  it('hides a short value with a digit and a letter around a delimiter', () => {
    expect(scrubText(`${tk}=a1,b2 next`)).toBe(`${tk}=${R} next`);
  });

  it('keeps ordinary prose and structure after the delimiter', () => {
    for (const text of [
      `${pw}: swordfish, then run`,
      `${pw}: swordfish; then run`,
      `(${pw}: swordfish)`,
      `${tk}=5,name=bob,other=x`,
      `{"max":1,"${tk}_type":"a"}`,
      `${pw}: north.`,
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });

  it('keeps the fields that follow a short unquoted value in minified JSON', () => {
    expect(scrubText(`{"${tk}":5,"other":"x","k":"y"}`)).toBe(`{"${tk}":5,"other":"x","k":"y"}`);
  });

  it('is linear when many credential keys sit in one long run', () => {
    const text = `${pw}=a,`.repeat(MiB / 9);
    const start = performance.now();
    scrubText(text);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('more credential words in text (step 6)', () => {
  it.each([
    ['session_id', 'abc123XYZ789'],
    ['sessionId', 'abc123XYZ789'],
    ['jwt', 'abc123XYZ789'],
    ['auth', 'abc123XYZ789'],
    ['access_key', 'abc123XYZ789'],
    ['signing_key', 'abc123XYZ789'],
    ['ssh_key', 'abc123XYZ789'],
  ])('hides %s=VALUE and %s: VALUE', (key, value) => {
    expect(scrubText(`${key}=${value}`)).toBe(`${key}=${R}`);
    expect(scrubText(`x ${key}: ${value}`)).toBe(`x ${key}: ${R}`);
    expect(scrubText(`{"${key}":"${value}"}`)).toBe(`{"${key}":"${R}"}`);
  });

  it.each([
    'auth: none',
    'auth=true',
    'author: Burnett',
    'session: 4',
    'session_id: 4',
    'jwt: none',
    'key: gold',
    'sig=abc',
    'code=12345678',
    'access: granted',
  ])('keeps %s', (text) => {
    expect(scrubText(text)).toBe(text);
  });
});
