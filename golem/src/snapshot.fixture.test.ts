import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixtureSnapshots } from './snapshot.fixture-cases.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// Every field present in `expected` must still be present and equal in `actual`.
// Extra fields in `actual` are allowed (probes add optional fields). Arrays are
// compared element-wise on the expected prefix; `actual` may be longer.
function subsetMismatches(expected: Json, actual: Json | undefined, path = '$'): string[] {
  if (actual === undefined) return [`${path}: missing`];
  if (expected === null || typeof expected !== 'object') {
    return expected === actual
      ? []
      : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array`];
    if (actual.length < expected.length) {
      return [`${path}: expected at least ${expected.length} elements, got ${actual.length}`];
    }
    return expected.flatMap((item, i) => subsetMismatches(item, actual[i], `${path}[${i}]`));
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    return [`${path}: expected an object`];
  }
  return Object.keys(expected).flatMap((key) =>
    subsetMismatches(expected[key] as Json, actual[key], `${path}.${key}`),
  );
}

describe('buildSnapshot output', () => {
  it('keeps every field of the fixture captured before the probe split (PX-S1)', () => {
    // A .txt so Biome does not reformat the bytes; the content is the JSON the builder serializes.
    const fixture = readFileSync(new URL('./snapshot.fixture.txt', import.meta.url), 'utf8');
    const expected = JSON.parse(fixture) as Json;
    const actual = JSON.parse(JSON.stringify(fixtureSnapshots())) as Json;
    expect(subsetMismatches(expected, actual)).toEqual([]);
  });
});

describe('subsetMismatches', () => {
  it('passes when a probe adds an optional field', () => {
    expect(
      subsetMismatches(
        { a: 1, nested: { b: 'x' } },
        { a: 1, extra: true, nested: { b: 'x', c: 2 } },
      ),
    ).toEqual([]);
  });

  it('passes when an array gains trailing elements', () => {
    expect(subsetMismatches({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual([]);
  });

  it('fails when an existing field changes value', () => {
    expect(subsetMismatches({ a: 1, nested: { b: 'x' } }, { a: 2, nested: { b: 'x' } })).toEqual([
      '$.a: expected 1, got 2',
    ]);
  });

  it('fails when an existing array element changes', () => {
    expect(subsetMismatches({ list: [1, 2] }, { list: [1, 9] })).toEqual([
      '$.list[1]: expected 2, got 9',
    ]);
  });

  it('fails when an existing field is removed', () => {
    expect(subsetMismatches({ a: 1, b: 2 }, { a: 1 })).toEqual(['$.b: missing']);
  });

  it('fails when a nested field is removed', () => {
    expect(subsetMismatches({ self: { health: 20 } }, { self: {} })).toEqual([
      '$.self.health: missing',
    ]);
  });

  it('fails when an array shrinks', () => {
    expect(subsetMismatches({ list: [1, 2] }, { list: [1] })).toEqual([
      '$.list: expected at least 2 elements, got 1',
    ]);
  });

  it('fails when a field that was an object becomes a scalar', () => {
    expect(subsetMismatches({ self: { health: 20 } }, { self: 20 })).toEqual([
      '$.self: expected an object',
    ]);
  });
});
