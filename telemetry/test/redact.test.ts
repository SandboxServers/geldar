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

describe('redactContent: plain JSON-safe output', () => {
  it('turns a bigint, symbol and function into text', () => {
    const out = redactContent({ n: 10n, s: Symbol('x'), f: function named() {} });
    expect(out).toEqual({ n: '10', s: 'Symbol(x)', f: 'function named() {}' });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('keeps a Date as an ISO string and marks an invalid one', () => {
    expect(redactContent({ at: new Date(Date.UTC(2026, 10, 16, 12, 0, 0)) })).toEqual({
      at: '2026-11-16T12:00:00.000Z',
    });
    expect(redactContent(new Date(Number.NaN))).toBe('Invalid Date');
  });

  it('copies Map and Set entries with redaction and a bound', () => {
    const map = new Map<string, unknown>([
      ['a', 'Bearer abc123'],
      [word, 'x'],
    ]);
    expect(redactContent({ m: map, s: new Set(['ok', token]) })).toEqual({
      m: [
        ['a', REDACTED],
        [word, REDACTED],
      ],
      s: ['ok', REDACTED],
    });
    const big = new Set(Array.from({ length: 1500 }, (_, i) => i));
    const out = redactContent(big) as unknown[];
    expect(out).toHaveLength(1001);
    expect(out.at(-1)).toBe('[truncated]');
  });

  it('keeps an Error as name, message and stack, scrubbed', () => {
    const out = redactContent({ e: new RangeError(`bad ${token}`) }) as {
      e: { name: string; message: string; stack: string };
    };
    expect(out.e.name).toBe('RangeError');
    expect(out.e.message).toBe(`bad ${REDACTED}`);
    expect(out.e.stack).toContain('RangeError');
    expect(out.e.stack).not.toContain(token);
  });

  it('replaces a Buffer and typed arrays by a byte count', () => {
    expect(redactContent(Buffer.from('abc'))).toBe('[binary 3 bytes]');
    expect(redactContent({ u: new Uint16Array(4), b: new ArrayBuffer(5) })).toEqual({
      u: '[binary 8 bytes]',
      b: '[binary 5 bytes]',
    });
  });
});

describe('scrubText: credential forms', () => {
  const R = REDACTED;
  const b64 = ['dXNlcjpw', 'ZA=='].join('');
  const cases: [string, string, string][] = [
    ['JSON Basic', `{"Authorization":"Basic ${b64}"}`, `{"Authorization":"${R}"}`],
    ['JSON Token lower key', '{"authorization": "Token abcdef"}', `{"authorization": "${R}"}`],
    ['lower-case bearer with token', 'bearer abc12345', R],
    ['Bearer colon', 'Bearer: abcdef', R],
    ['Bearer quoted', 'Bearer "abcdef" next', `${'"'}${R}" next`],
    ['password with @', 'https://u:p@ss@host/x', `https://${R}@host/x`],
    ['Proxy-Authorization', 'Proxy-Authorization: Basic abc', R],
    ['bare 16+ token', `Authorization: ${'ab12'.repeat(5)}`, R],
  ];
  it.each(cases)('redacts %s', (_name, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  const kept: [string, string][] = [
    ['curl keeps quote and url', 'curl -H "Authorization: Bearer abc" http://x'],
    ['prose authorization', 'The authorization: grants access to everyone'],
    ['bearer of bad news', 'Bearer of bad news'],
    ['lower prose bearer', 'a bearer wisdom story'],
    ['plain email', 'user@host and a@b'],
  ];
  it.each(kept)('keeps %s', (name, input) => {
    if (name === 'curl keeps quote and url') {
      expect(scrubText(input)).toBe(`curl -H "${REDACTED}" http://x`);
    } else {
      expect(scrubText(input)).toBe(input);
    }
  });
});

describe('scrubText: free-text key=value', () => {
  const R = REDACTED;
  const redacted: [string, string][] = [
    ['password=hunter2 token=abc', `password=${R} token=${R}`],
    ['api_key: xyz', `api_key: ${R}`],
    ['x-api-key=abc&next=1', `x-api-key=${R}&next=1`],
    ['{"client_secret":"s3cr3t","ok":1}', `{"client_secret":"${R}","ok":1}`],
    ['access_token=aaa refresh_token: bbb', `access_token=${R} refresh_token: ${R}`],
    ['Cookie=sid123; path=/', `Cookie=${R}; path=/`],
    ['passwd = longer-than-usual', `passwd = ${R}`],
    [`secret=${'z'.repeat(600)} tail`, `secret=${R} tail`],
  ];
  it.each(redacted)('redacts %s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  const kept = [
    'max_tokens=100',
    'input_tokens: 12',
    'tokens=5',
    'email: bob@example.org',
    'name=steve count: 4',
    'time: 12:30:45',
  ];
  it.each(kept)('keeps %s', (input) => {
    expect(scrubText(input)).toBe(input);
  });

  it('is idempotent', () => {
    const once = scrubText('password=hunter2 token=abc');
    expect(scrubText(once)).toBe(once);
  });

  it('stays fast on 1 MiB inputs', () => {
    const size = 1 << 20;
    const rep = (unit: string): string => unit.repeat(Math.ceil(size / unit.length));
    const inputs = {
      passwords: rep('password='),
      passwordColons: rep('password: '),
      tokens: rep('token'),
      tokenEq: rep('token='),
      colons: rep(':'),
      equals: rep('='),
      pairs: rep('a=b '),
      longKey: `${'k'.repeat(size)}=v`,
      longValue: `token=${'v'.repeat(size)}`,
      eqSpaces: `token=${' '.repeat(size)}x`,
      quotes: rep('token":"'),
    };
    for (const [name, input] of Object.entries(inputs)) {
      expect(timeScrub(input), name).toBeLessThan(500);
    }
    expect(timeScrub('x'.repeat(10 * (1 << 20)))).toBeLessThan(500);
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
