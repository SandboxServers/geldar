import { describe, expect, it } from 'vitest';
import { computeReport } from '../src/report.ts';
import type { RunData } from '../src/types.ts';
import { PENDING } from '../src/types.ts';
import { criteria, manifest } from './fixture.ts';

const EMPTY: RunData = { thoughts: [], intents: [], actions: [], receipts: [], events: [] };

/** The model floor measure for one recorded owner verdict (null when not yet recorded). */
function floorFor(verdict: string | null) {
  const report = computeReport({
    manifest: manifest(),
    criteria: criteria({ modelFloorVerdict: verdict }),
    data: EMPTY,
  });
  const m = report.measures.find((x) => x.id === 'model_floor');
  if (m === undefined) throw new Error('no model_floor measure');
  return m;
}

describe('model floor measure', () => {
  it('is UNKNOWN with the pending note when the owner has not recorded a verdict', () => {
    const m = floorFor(null);
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe(PENDING);
    expect(m.values).toEqual({});
  });

  it('echoes the owner recorded floor, and never computes it from the rows', () => {
    const m = floorFor('8B');
    expect(m.verdict).toBe('PASS');
    expect(m.values).toEqual({ floor: '8B' });
    expect(m.note).toBe('recorded by the owner in the criteria file');
  });
});
