import { describe, expect, it } from 'vitest';
import { REDACTED as R, scrubText } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const tk = ['to', 'ken'].join('');
const sec = ['sec', 'ret'].join('');
const ck = ['coo', 'kie'].join('');
const hex = 'a1b2c3d4e5f6';

describe('scrubText keeps ordinary game and prose text (decision 0350: redact only credentials)', () => {
  const ordinary = [
    'Secret: north',
    `${sec}=north`,
    `${pw}: swordfish`,
    'Password: please',
    `${tk}: 5`,
    `${tk}=gold coin`,
    `${ck}: chocolate chip`,
    'Cookie: 3 in chest',
    'credential: none',
    `Enter the ${pw}: open sesame`,
    `${ck}s=12`,
    `${sec}s: 3`,
    `${sec}ary: Bob`,
    'sessionid: 4',
    'pwd: /home',
    `s=1234567890`,
    `ary: Bartholomew_2`,
    'tokens=123456789',
    'pwd=/tmp',
    'Standard Bearer Alexander arrives',
    'Flag Bearer Gandalf',
    'Torch Bearer: Alexander',
    'the bearer of bad news',
    'Bearer of bad news',
    `${tk} economy`,
    'Authorization: not-yet-granted-by-admin',
    'The Secret Garden',
    `${sec} door: north`,
    'key: gold',
    'monkey=banana',
    'compass: north',
    'author: Burnett',
    'max_tokens=100',
    'input_tokens: 12',
    'time: 12:30:45',
    'https://example.org/path',
    'user@example.org',
  ];
  it.each(ordinary)('keeps %s', (input) => {
    expect(scrubText(input)).toBe(input);
  });

  it('redacts access_token but keeps token_type', () => {
    expect(scrubText(`{"access_${tk}":"${hex}","${tk}_type":"Bearer"}`)).toBe(
      `{"access_${tk}":"${R}","${tk}_type":"Bearer"}`,
    );
  });
});

describe('scrubText hides credential-looking values', () => {
  const cases: [string, string, string][] = [
    ['mixed value after colon', `${pw}: Xk3_${hex}`, `${pw}: ${R}`],
    ['hex value', `${tk}: ${hex}${hex}`, `${tk}: ${R}`],
    ['long lower-case value', `${sec}=${'z'.repeat(12)}`, `${sec}=${R}`],
    ['digits only', `${tk}: 12345678`, `${tk}: ${R}`],
    ['query short value', `/p?x=1&${tk}=abc`, `/p?x=1&${tk}=${R}`],
    ['flag short value', `--${pw}=x`, `--${pw}=${R}`],
    ['quoted value with spaces in code', `${pw}="open sesame now"`, `${pw}="${R}"`],
    ['quoted prose value stays a word', `${pw}: "open sesame"`, `${pw}: "open sesame"`],
    ['cookie pairs', `Cookie: a=1; sid=${hex}`, `Cookie: ${R}`],
    ['lower-case bearer with digit', `bearer ${hex}`, R],
    ['capital Bearer long mixed', `Bearer ${hex}`, R],
    ['capital Bearer 8 chars with digit', 'Bearer abcd1234', R],
    ['aws secret key name', `aws_secret_access_key = ${hex}${hex}`, `aws_secret_access_key = ${R}`],
    ['underscore api key', `API_${tk.toUpperCase()}=${hex}`, `API_${tk.toUpperCase()}=${R}`],
  ];
  it.each(cases)('%s', (_n, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });
});

describe('scrubText URL userinfo with prefixed or long schemes', () => {
  const p = ['p', 'w'].join('');
  const cases: [string, string][] = [
    ['dot prefix', `1.https://u:${p}@h`],
    ['digit prefix', `2https://u:${p}@h`],
    ['symbol prefix', `-https://u:${p}@h`],
    ['plain', `https://u:${p}@h`],
    ['40-char scheme', `${'a'.repeat(40)}://u:${p}@h`],
  ];
  it.each(cases)('hides the password with a %s', (_n, input) => {
    const out = scrubText(input);
    expect(out).not.toContain(`u:${p}@`);
    expect(out).toContain(`${R}@h`);
  });

  const MiB = 1 << 20;
  const timed = (s: string): number => {
    const start = performance.now();
    scrubText(s);
    return performance.now() - start;
  };
  const rep = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length));
  it.each(['a', 'a.', 'a+', 'x://u:', 'http://'])(
    'is linear on %s repeated',
    (unit) => {
      timed(rep(unit, 1 << 16));
      const t1 = timed(rep(unit, MiB));
      const t2 = timed(rep(unit, 2 * MiB));
      expect(t1).toBeLessThan(1000);
      expect(t2).toBeLessThan(3 * t1 + 100);
      expect(timed(rep(unit, 10 * MiB))).toBeLessThan(5000);
    },
    60_000,
  );
});
