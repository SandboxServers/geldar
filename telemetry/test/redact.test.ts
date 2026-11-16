import { describe, expect, it } from 'vitest';
import { errorFields, REDACTED, redactContent, scrubText } from '../src/redact.ts';

// Fixtures are built at run time so no literal credential-shaped string sits in the source.
const token = ['gmcp', 'a1'.repeat(32)].join('-');
const word = ['pass', 'word'].join('');

describe('redactContent', () => {
  it('redacts secret-named keys at any depth and copies the input', () => {
    const input = { a: { [word]: 'x', keep: 1 }, list: [{ ['to' + 'ken']: 'y', ok: 'fine' }] };
    expect(redactContent(input)).toEqual({
      a: { [word]: REDACTED, keep: 1 },
      list: [{ token: REDACTED, ok: 'fine' }],
    });
    expect(input.a[word]).toBe('x');
  });

  it('scrubs string values: a bearer string and a token-shaped string', () => {
    const out = redactContent({ note: 'Bearer abc123', other: [token], n: 3 });
    expect(out).toEqual({ note: REDACTED, other: [REDACTED], n: 3 });
  });

  it('leaves ordinary prose alone', () => {
    expect(scrubText('the bearer of bad news')).toBe('the bearer of bad news');
    expect(redactContent('mail me at a@b.example')).toBe('mail me at a@b.example');
  });

  it('keeps a __proto__ key as an own key', () => {
    const input = JSON.parse('{"__proto__": {"x": 1}}') as unknown;
    const out = redactContent(input) as object;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['__proto__']);
  });

  it('marks a cycle and a too-deep object', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(redactContent(loop)).toEqual({ self: '[cycle]' });
    let deep: unknown = { end: true };
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(JSON.stringify(redactContent(deep))).toContain('[truncated]');
  });
});

describe('redactContent on hostile objects', () => {
  const boom = (): never => {
    throw new Error('boom');
  };

  it('marks a throwing getter and keeps the other fields', () => {
    const input = {
      ok: 'fine',
      get bad(): string {
        return boom();
      },
    };
    expect(redactContent(input)).toEqual({ ok: 'fine', bad: '[unreadable]' });
  });

  it('survives a Proxy whose get, ownKeys or getPrototypeOf throws', () => {
    const getTrap = new Proxy({ a: 1 }, { get: boom });
    const keysTrap = new Proxy({ a: 1 }, { ownKeys: boom });
    const protoTrap = new Proxy({ a: 1 }, { getPrototypeOf: boom });
    expect(redactContent(getTrap)).toEqual({ a: '[unreadable]' });
    expect(redactContent(keysTrap)).toBe('[unreadable]');
    expect(() => redactContent(protoTrap)).not.toThrow();
    expect(redactContent({ nested: keysTrap, n: 1 })).toEqual({ nested: '[unreadable]', n: 1 });
  });

  it('survives a throwing array length and a revoked Proxy', () => {
    const arr = new Proxy([1, 2], { get: boom });
    expect(redactContent({ arr })).toEqual({ arr: '[unreadable]' });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(redactContent(proxy)).toBe('[unreadable]');
    expect(redactContent({ p: proxy, n: 1 })).toEqual({ p: '[unreadable]', n: 1 });
  });

  it('ignores a throwing toJSON and Symbol.toPrimitive', () => {
    const input = { toJSON: boom, [Symbol.toPrimitive]: boom, keep: 'x' };
    expect(() => redactContent(input)).not.toThrow();
    expect((redactContent(input) as Record<string, unknown>).keep).toBe('x');
  });
});

describe('scrubText', () => {
  it('replaces Authorization values, tokens and URL userinfo', () => {
    expect(scrubText('Authorization: Basic zzz\nnext')).toBe(`${REDACTED}\nnext`);
    expect(scrubText(`t=${token}!`)).toBe(`t=${REDACTED}!`);
    const url = `https://user:${['p', 'w'].join('')}@host.example/path`;
    expect(scrubText(url)).toBe(`https://${REDACTED}@host.example/path`);
  });
});

/** Adversarial inputs of about `size` characters, aimed at every pattern in redact.ts. */
function adversarial(size: number): Record<string, string> {
  const rep = (unit: string): string => unit.repeat(Math.ceil(size / unit.length));
  return {
    letters: rep('a'),
    base64: rep('QUJD'),
    hex: rep('0123456789abcdef'),
    bearers: rep('Bearer '),
    bearerSpaces: `Bearer${' '.repeat(size)}`,
    bearerQuotes: rep('Bearer "'),
    authWords: rep('Authorization'),
    authSpaces: `Authorization${' '.repeat(size)}x`,
    authColons: rep('Authorization: '),
    authJson: rep('{"Authorization":'),
    mcpPrefix: rep('gmcp-'),
    mcpPartial: `gmcp-${'a'.repeat(size)}`,
    schemes: rep('http://'),
    schemeUser: `x://u:${'p'.repeat(size)}`,
    plusRun: `${'a+'.repeat(size / 2)}://x:y`,
    userColons: `http://${'u:'.repeat(size / 2)}`,
    colons: rep(':'),
    ats: rep('@'),
    colonAt: rep(':@'),
    schemeColonAt: rep('a://:@'),
    slashes: rep('/'),
  };
}

function timeScrub(input: string): number {
  const start = performance.now();
  scrubText(input);
  return performance.now() - start;
}

describe('scrubText on large adversarial input', () => {
  it('stays fast on 1 MiB inputs (every pattern)', () => {
    for (const [name, input] of Object.entries(adversarial(1 << 20))) {
      expect(timeScrub(input), name).toBeLessThan(500);
    }
  });

  it('stays linear on 40 KB inputs (distinguishes a quadratic pattern)', () => {
    for (const [name, input] of Object.entries(adversarial(40_000))) {
      expect(timeScrub(input), name).toBeLessThan(60);
    }
  });
});

describe('errorFields', () => {
  it('hides a token in a thrown object message and its stack', () => {
    const err = new TypeError(`bad ${token}`);
    const fields = errorFields(err);
    expect(fields['exception.type']).toBe('TypeError');
    expect(fields['exception.message']).toBe(`bad ${REDACTED}`);
    expect(fields['exception.stacktrace']).not.toContain(token);
  });

  it('handles a non-Error value and never throws', () => {
    expect(errorFields(`Bearer ${'q'.repeat(8)}`)).toEqual({
      'exception.type': 'string',
      'exception.message': REDACTED,
    });
    const hostile = {
      toString() {
        throw new Error('no');
      },
    };
    expect(() => errorFields(hostile)).not.toThrow();
    expect(errorFields(hostile)['exception.type']).toBe('unknown');
  });
});
