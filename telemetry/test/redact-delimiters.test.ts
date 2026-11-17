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
    expect(performance.now() - start).toBeLessThan(6000);
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

describe('a delimiter at every split point of an 18-character password (step 4, fix pass 4)', () => {
  const secret = 'Zq9xK2mP7vL4AbR5tY';
  const forms: [string, string][] = [
    ['login password=', ' ok'],
    ['GET /x?password=', ' HTTP/1.1'],
    ['run --password=', ' --verbose'],
    ['login password: ', ' ok'],
  ];
  const delimiters = [',', ';', '&', ')', '}'];
  const windows = (s: string): string[] =>
    Array.from({ length: s.length - 3 }, (_, i) => s.slice(i, i + 4));

  it('leaks no 4-character window of the password: 4 forms x 17 split points x 5 delimiters', () => {
    const leaks: string[] = [];
    for (const [head, tail] of forms)
      for (const d of delimiters)
        for (let at = 1; at < secret.length; at++) {
          const password = secret.slice(0, at) + d + secret.slice(at);
          const out = scrubText(`${head}${password}${tail}`);
          if (windows(password).some((w) => out.includes(w))) leaks.push(`${head}${password}`);
        }
    expect(leaks).toEqual([]);
  });

  it('hides a backslash or a quote inside an unquoted value', () => {
    for (const mid of ['\\', '"x', '=y']) {
      const out = scrubText(`login ${pw}=Zq9xK2mP${mid}7vL4AbR5tY ok`);
      expect(out).not.toContain('7vL4');
      expect(out).toContain(' ok');
    }
  });

  it('stops at the next pair and keeps trailing punctuation', () => {
    expect(scrubText(`${pw}=Zq9x,K2mP7vL4Ab,user=bob`)).toBe(`${pw}=${R},user=bob`);
    expect(scrubText(`?${pw}=Zq9x&K2mP7vL4Ab&x=1`)).toBe(`?${pw}=${R}&x=1`);
    expect(scrubText(`(${pw}=Zq9xK2mP7vL4Ab,R5tY).`)).toBe(`(${pw}=${R}).`);
    expect(scrubText(`${pw}=abcdefghi, then`)).toBe(`${pw}=abcdefghi, then`);
    expect(scrubText(`${pw}: swordfish, then`)).toBe(`${pw}: swordfish, then`);
  });

  const MiB = 1 << 20;
  const timed = (s: string): number => {
    const start = performance.now();
    scrubText(s);
    return performance.now() - start;
  };
  const shapes: [string, string][] = [
    ['key and delimiter', `${pw}=Zq9x,K2mP7vL4Ab `],
    ['trailing delimiter run', `${pw}:a${','.repeat(510)}x `],
    ['trailing paren run', `${pw}:a${')'.repeat(510)}x `],
    ['pair cuts', `${pw}=a,b=c,${pw}=d,e=f `],
  ];
  it.each(shapes)(
    'is linear and fast on %s at 1 MiB and 10 MiB',
    (_n, unit) => {
      const rep = (size: number): string => unit.repeat(Math.ceil(size / unit.length));
      expect(Math.min(timed(rep(MiB)), timed(rep(MiB)))).toBeLessThan(3000);
      expect(timed(rep(10 * MiB))).toBeLessThan(3000);
    },
    60_000,
  );
});
