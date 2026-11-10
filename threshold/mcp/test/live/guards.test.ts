import { describe, expect, it } from 'vitest';
import { assertTestPlayer, jsonHas } from './guards.ts';

describe('assertTestPlayer', () => {
  it('accepts a player id that carries the test marker', () => {
    expect(assertTestPlayer('ag-test-01')).toBe('ag-test-01');
  });

  it('refuses an operator player and the life-id form, before any case acts', () => {
    expect(() => assertTestPlayer('ag-jason-01')).toThrow('without the ag-test- marker');
    expect(() => assertTestPlayer('ag_test_01')).toThrow('without the ag-test- marker');
  });
});

describe('jsonHas', () => {
  it('finds a plain canary inside the JSON of a value', () => {
    expect(jsonHas({ speech: ['hello canary'] }, 'hello canary')).toBe(true);
  });

  it('finds a canary with quotes and newlines in its JSON-escaped form', () => {
    const canary = 'line "one"\nline two\\end';
    expect(jsonHas({ untrusted_world_text: { speech: [canary] } }, canary)).toBe(true);
  });

  it('does not find an absent canary, or the raw form of an escaped one', () => {
    expect(jsonHas({ rest: 'nothing here' }, 'missing')).toBe(false);
    expect(jsonHas({ rest: 'a \\"b\\" c' }, 'a "b" c')).toBe(false);
  });

  it('treats an undefined value as holding nothing', () => {
    expect(jsonHas(undefined, 'x')).toBe(false);
  });
});
