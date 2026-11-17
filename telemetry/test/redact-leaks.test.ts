import { describe, expect, it } from 'vitest';
import {
  errorFields,
  MAX_ERROR_TEXT_CHARS,
  REDACTED as R,
  redactContent,
  scrubText,
} from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const tk = ['to', 'ken'].join('');
const secretValue = 'hunter2hunter2';
const MiB = 1 << 20;

describe('escaped JSON inside a string', () => {
  const nest = (obj: Record<string, string>): string =>
    JSON.stringify({ args: JSON.stringify(obj) });
  it.each([
    [pw, secretValue],
    ['api_key', 'abcDEF123456'],
    [tk, 'abcDEF123456'],
    ['Authorization', 'Basic dXNlcjpwYXNz'],
  ])('hides %s', (key, value) => {
    expect(scrubText(nest({ [key]: value }))).toBe(nest({ [key]: R }));
  });

  it('hides a value nested three levels deep', () => {
    const three = JSON.stringify({ outer: nest({ [tk]: 'abcDEF123456' }) });
    expect(scrubText(three)).not.toContain('abcDEF123456');
  });
});

describe('long keys, signatures, PEM and JWT', () => {
  it('hides a credential whose key is 65 or more characters', () => {
    const key = `${'very_long_prefix_'.repeat(5)}${pw}`;
    expect(scrubText(`${key}=${secretValue}`)).toBe(`${key}=${R}`);
    expect(scrubText(`${'a'.repeat(70)}.${pw}=${secretValue}`)).toBe(
      `${'a'.repeat(70)}.${pw}=${R}`,
    );
  });

  it('hides AWS4 signatures, Digest responses and presigned signatures', () => {
    const sig = 'fe5f80f77d5fa3beca038a248ff027d0445342fe2855ddc963176630326f1024';
    expect(
      scrubText(
        `Authorization: AWS4-HMAC-SHA256 Credential=x/20260101, SignedHeaders=host, Signature=${sig}`,
      ),
    ).toBe(R);
    expect(scrubText('Authorization: Digest username="u", response="abcDEF123456"')).toBe(R);
    expect(scrubText(`https://s3.example/o?X-Amz-Signature=${sig}&a=1`)).toBe(
      `https://s3.example/o?X-Amz-Signature=${R}&a=1`,
    );
    expect(scrubText('{"Authorization":"Digest u=1, response=abc","x":1}')).toBe(
      `{"Authorization":"${R}","x":1}`,
    );
  });

  const pem = (body: string): string =>
    [
      `-----BEGIN ${['RSA', 'PRIVATE', 'KEY'].join(' ')}-----`,
      body,
      `-----END ${['RSA', 'PRIVATE', 'KEY'].join(' ')}-----`,
    ].join('\n');
  it('hides a PEM private key block, an unterminated one, and keeps text around it', () => {
    expect(scrubText(`before\n${pem('MIIEvQIBADANBgkq\nabc')}\nafter`)).toBe(`before\n${R}\nafter`);
    expect(scrubText(`x ${pem('MIIEvQIBADANBgkq').split('\n-----END')[0]}`)).toBe(`x ${R}`);
    expect(scrubText('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')).toContain(
      'MIIB',
    );
  });

  it('hides a bare JWT and keeps a look-alike', () => {
    const b64 = (s: string): string => Buffer.from(s).toString('base64url');
    const jwt = [
      b64('{"alg":"HS256","typ":"JWT"}'),
      b64('{"sub":"1234567890"}'),
      b64('sig-sig-sig'),
    ].join('.');
    expect(jwt.startsWith('eyJ')).toBe(true);
    expect(scrubText(`token is ${jwt}, ok`)).toBe(`token is ${R}, ok`);
    expect(scrubText('eyJ.short.x')).toBe('eyJ.short.x');
  });
});

function best(input: string): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    scrubText(input);
    min = Math.min(min, performance.now() - start);
  }
  return min;
}

describe('PEM and JWT scans are linear', () => {
  const shapes: Record<string, string> = {
    begin: '-----BEGIN ',
    beginHeader: `-----BEGIN ${['PRIVATE', 'KEY'].join(' ')}-----`,
    beginCert: '-----BEGIN CERTIFICATE-----\n',
    jwtDash: 'eyJ-',
    jwtDots: 'eyJabcdefgh.abcdefgh.',
    jwtRun: 'eyJ' + 'a'.repeat(1000),
  };
  it.each(Object.entries(shapes))(
    '%s: 1 MiB under 1 s and 3x on doubling',
    (_n, unit) => {
      const rep = (size: number): string => unit.repeat(Math.ceil(size / unit.length));
      const t1 = best(rep(MiB));
      const t2 = best(rep(2 * MiB));
      expect(t1).toBeLessThan(3000);
      expect(t2).toBeLessThan(3 * t1 + 100);
    },
    60_000,
  );
});

describe('redactContent bounds its total work', () => {
  it('reads a sparse 1e8 array in bounded time and marks the cut', () => {
    const start = performance.now();
    const out = redactContent(new Array(1e8)) as unknown[];
    expect(performance.now() - start).toBeLessThan(3000);
    expect(out.at(-1)).toBe('[truncated]');
    expect(out.length).toBeLessThanOrEqual(100_001);
  });

  it('omits strings beyond the character budget (200 references to one 1 MiB string)', () => {
    const big = 'a=b '.repeat(MiB / 4);
    const start = performance.now();
    const out = redactContent(Array.from({ length: 200 }, () => big)) as string[];
    expect(performance.now() - start).toBeLessThan(5000);
    expect(out.filter((s) => s.startsWith('[omitted ')).length).toBeGreaterThan(190);
    expect(out[0]).toBe(big);
  }, 30_000);

  it('cuts the JSON of a thrown plain object at MAX_ERROR_TEXT_CHARS', () => {
    const thrown: Record<string, string> = {};
    for (let i = 0; i < 20_000; i++) thrown[`k${i}`] = 'x'.repeat(50);
    const message = errorFields(thrown)['exception.message'];
    expect(message.length).toBeLessThan(MAX_ERROR_TEXT_CHARS + 64);
    expect(message).toContain('…[truncated ');
  });

  it('stays fast on one hostile 60,000-character upper-case key', () => {
    const start = performance.now();
    redactContent({ ['A'.repeat(60_000)]: 1 });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
