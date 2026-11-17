import { describe, expect, it } from 'vitest';
import { hasForbiddenSegment } from '../src/attributes.ts';
import { redactContent, scrubText } from '../src/redact.ts';

const MiB = 1 << 20;

// 64 MiB for the shapes that overflowed V8's regex stack (a counted greedy loop); 16 MiB for the rest
// (memory and run time: every shape is scrubbed once, linear, about 0.1 to 2 s per 10 MiB).
const OVERFLOW_PREFIXES = ['Bearer ', 'bearer=', 'BEARER: "'];
const RUN_PREFIXES = [
  'Authorization: Basic ',
  'Authorization: ',
  'gmcp-',
  'http://u:',
  'password=',
  'token: ',
  '"password":"',
  'eyJ',
  '-----BEGIN PRIVATE KEY-----',
  'key=',
  'a=b:',
];

function noFallback(out: string): void {
  expect(out.startsWith('[unscrubbable')).toBe(false);
}

describe('scrubText never overflows the regex stack', () => {
  it('survives a 64 MiB run after bearer and hides it', () => {
    for (const prefix of OVERFLOW_PREFIXES) {
      const out = scrubText(prefix + 'a'.repeat(64 * MiB));
      noFallback(out);
      expect(out.length, prefix).toBeLessThan(64);
    }
  }, 300_000);

  it('survives a 16 MiB run after every prefix and a 16 MiB repeat of it', () => {
    for (const prefix of RUN_PREFIXES) {
      noFallback(scrubText(prefix + 'a'.repeat(16 * MiB)));
      noFallback(scrubText(prefix.repeat(Math.ceil((16 * MiB) / prefix.length))));
    }
  }, 300_000);

  it('survives the same runs through redactContent (no [unreadable])', () => {
    const out = redactContent({ v: `Bearer ${'a'.repeat(8 * MiB)}` }) as { v: string };
    expect(out.v).toBe('[redacted]');
  }, 60_000);

  it('replaces the text with a placeholder when the scrub itself throws', () => {
    const hostile = {
      length: 42,
      replace(): never {
        throw new RangeError('Maximum call stack size exceeded');
      },
    } as unknown as string;
    expect(scrubText(hostile)).toBe('[unscrubbable 42 chars]');
  });
});

/** The normalisation hasForbiddenSegment used before the fix (kept here as the reference). */
function oldNormalise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
function newNormalise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1_')
    .toLowerCase();
}

describe('hasForbiddenSegment is linear on capital runs', () => {
  it('normalises exactly like the old implementation on 200,000 random strings', () => {
    const alphabet = 'aAbBZz19_.-';
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    for (let n = 0; n < 200_000; n++) {
      const len = 1 + (next() % 14);
      let s = '';
      for (let i = 0; i < len; i++) s += alphabet[next() % alphabet.length];
      expect(newNormalise(s), s).toBe(oldNormalise(s));
    }
  });

  it('keeps the known camelCase decisions', () => {
    for (const key of ['apiKey', 'APIKey', 'HTTPSToken', 'sessionID', 'XMLPassword'])
      expect(hasForbiddenSegment(key), key).toBe(true);
    for (const key of ['XMLHttpRequest', 'max_tokens', 'HTTPServer'])
      expect(hasForbiddenSegment(key), key).toBe(false);
  });

  it('checks a 1 MiB capital run in well under a second, and a hostile key in redactContent', () => {
    const start = performance.now();
    expect(hasForbiddenSegment('A'.repeat(MiB))).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
    const start2 = performance.now();
    redactContent({ ['A'.repeat(200_000)]: 1 });
    expect(performance.now() - start2).toBeLessThan(500);
  });
});
