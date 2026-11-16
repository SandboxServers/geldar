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

describe('scrubText', () => {
  it('replaces Authorization values, tokens and URL userinfo', () => {
    expect(scrubText('Authorization: Basic zzz\nnext')).toBe(`${REDACTED}\nnext`);
    expect(scrubText(`t=${token}!`)).toBe(`t=${REDACTED}!`);
    const url = `https://user:${['p', 'w'].join('')}@host.example/path`;
    expect(scrubText(url)).toBe(`https://${REDACTED}@host.example/path`);
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
