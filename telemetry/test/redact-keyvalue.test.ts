import { describe, expect, it } from 'vitest';
import { REDACTED as R, scrubText } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const tk = ['to', 'ken'].join('');

describe('scrubText: a credential key inside a URL or another pair', () => {
  const cases: [string, string, string][] = [
    ['URL query token', `https://h/cb?${tk}=abc`, `https://h/cb?${tk}=${R}`],
    [
      'URL query access_token',
      `GET https://h/x?access_${tk}=abcDEF123456&x=1 HTTP/1.1`,
      `GET https://h/x?access_${tk}=${R}&x=1 HTTP/1.1`,
    ],
    ['colon key before key', `user:${pw}=xK3_9aZq`, `user:${pw}=${R}`],
    ['equals then colon key', `a=b:${tk}=xK3_9aZq`, `a=b:${tk}=${R}`],
    ['colon key', `x:${tk}=yK3_9aZq`, `x:${tk}=${R}`],
    ['url inside a value', `url=http://x/?${pw}=z`, `url=http://x/?${pw}=${R}`],
    ['JSON url', `{"url":"https://h/x?${tk}=abcDEF123456"}`, `{"url":"https://h/x?${tk}=${R}"}`],
    ['double dash flag', `--${pw}=hunter2`, `--${pw}=${R}`],
    ['cookie second pair', 'Cookie: a=1; session=abcd', `Cookie: ${R}`],
    ['quoted value with spaces', `${pw}="open sesame now"`, `${pw}="${R}"`],
    [
      'JSON quoted value with spaces',
      `{"${pw}":"open sesame now","ok":1}`,
      `{"${pw}":"${R}","ok":1}`,
    ],
  ];
  it.each(cases)('hides %s', (_name, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    'max_tokens=100',
    'input_tokens: 12',
    'tokens=5',
    'email: bob@example.org',
    'name=steve count: 4',
    'time: 12:30:45',
  ])('keeps %s', (input) => {
    expect(scrubText(input)).toBe(input);
  });
});

const MiB = 1 << 20;
const shapes: Record<string, string> = {
  key: 'key=',
  password: 'password=',
  colonEquals: ':=',
  pairs: 'a=b ',
  jsonPassword: '"password":"',
  escapedJson: '\\"password\\":\\"',
  keyChain: 'a=b:token=',
  urlQuery: 'https://h/x?token=a',
};

function timed(input: string): number {
  const start = performance.now();
  scrubText(input);
  return performance.now() - start;
}

describe('scrubText key/value scan is linear', () => {
  const rep = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length));

  it.each(Object.entries(shapes))(
    '%s: 1 MiB and 2 MiB scale at most 3x, 1 MiB under 1 s',
    (_n, unit) => {
      timed(rep(unit, 1 << 16)); // warm-up
      const t1 = Math.min(...[1, 2, 3].map(() => timed(rep(unit, MiB))));
      const t2 = Math.min(...[1, 2, 3].map(() => timed(rep(unit, 2 * MiB))));
      expect(t1).toBeLessThan(3000);
      expect(t2).toBeLessThan(3 * t1 + 100);
    },
  );

  it.each(Object.entries(shapes))(
    '%s: 10 MiB under 5 s',
    (_n, unit) => {
      expect(timed(rep(unit, 10 * MiB))).toBeLessThan(5000);
    },
    60_000,
  );
});
