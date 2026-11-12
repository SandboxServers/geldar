import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixtureSnapshots } from './snapshot.fixture-cases.ts';

describe('buildSnapshot output', () => {
  it('stays byte-equal to the fixture captured before the probe split (PX-S1)', () => {
    // A .txt so Biome does not reformat the bytes; the content is the JSON the builder serializes.
    const fixture = readFileSync(new URL('./snapshot.fixture.txt', import.meta.url), 'utf8');
    expect(`${JSON.stringify(fixtureSnapshots(), null, 2)}\n`).toBe(fixture);
  });
});
