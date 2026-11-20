/**
 * Pins the runtime export names of @geldar/contract. index.ts is split into domain files later, and
 * this test shows that the split changes no public name: a dropped re-export fails here. A name
 * added on purpose also fails until the golden file is updated in the same change. The type
 * exports are pinned by public-types.check.ts, which tsc compiles.
 */
import { readFileSync } from 'node:fs';
import * as contract from '@geldar/contract';
import { describe, expect, it } from 'vitest';

const golden: string[] = JSON.parse(
  readFileSync(new URL('./public-surface.golden.json', import.meta.url), 'utf8'),
);

describe('@geldar/contract public surface', () => {
  it('exports exactly the runtime names in public-surface.golden.json', () => {
    expect(Object.keys(contract).sort()).toEqual(golden);
  });

  it('keeps the golden list sorted and free of duplicates', () => {
    expect(golden).toEqual([...new Set(golden)].sort());
  });

  it('pins a non-empty surface', () => {
    expect(golden.length).toBeGreaterThan(0);
  });
});
