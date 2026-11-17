import { describe, expect, it } from 'vitest';
import { REDACTED as R, redactContent } from '../src/redact.ts';

// Credential-shaped fixtures are built at run time.
const pw = ['pass', 'word'].join('');
const secret = 'Zq9xK2mP7vL4Ab';

describe('the work budget covers Error values (step 2)', () => {
  const run = (errors: Error[]): { ms: number; out: unknown[] } => {
    const start = performance.now();
    const out = redactContent(errors) as unknown[];
    return { ms: performance.now() - start, out };
  };

  it('finishes 300 Errors with 64 KiB messages quickly and omits the later ones', () => {
    const errors = Array.from({ length: 300 }, () => new Error('a'.repeat(65_536)));
    const { ms, out } = run(errors);
    expect(ms).toBeLessThan(1500);
    expect(out.filter((e) => typeof e === 'string' && e.startsWith('[omitted ')).length).toBeGreaterThan(200);
    expect(typeof out[0]).toBe('object');
  });

  it('finishes 300 Errors full of key= repetitions without emitting a credential', () => {
    const errors = Array.from(
      { length: 300 },
      () => new Error(`${pw}=${secret} `.repeat(Math.ceil(65_536 / 24))),
    );
    const { ms, out } = run(errors);
    expect(ms).toBeLessThan(1500);
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).toContain(R);
    expect(out.filter((e) => typeof e === 'string' && e.startsWith('[omitted ')).length).toBeGreaterThan(200);
  });

  it('omits an Error once the budget is gone even when it holds a credential', () => {
    const big = 'x'.repeat(4 * 1024 * 1024 + 1);
    const out = redactContent([big, new Error(`${pw}=${secret}`)]) as string[];
    expect(out[1]).toMatch(/^\[omitted \d+ chars\]$/);
  });

  it('omits an Error whose message getter throws without throwing', () => {
    const bad = new Error('x');
    Object.defineProperty(bad, 'message', {
      get() {
        throw new Error('no');
      },
    });
    expect(() => redactContent([bad])).not.toThrow();
  });
});

describe('a boxed primitive is its primitive (step 3)', () => {
  it('scrubs a boxed String as one string', () => {
    expect(redactContent(new String(`${pw}=${secret}`))).toBe(`${pw}=${R}`);
    expect(redactContent({ s: new String(`${pw}=${secret}`) })).toEqual({ s: `${pw}=${R}` });
  });

  it('returns boxed Number and Boolean as primitives', () => {
    expect(redactContent([new Number(5), new Boolean(false)])).toEqual([5, false]);
  });
});
