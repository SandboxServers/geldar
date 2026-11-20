import { describe, expect, it } from 'vitest';
import { IDENTITY_BUCKETS, planBucketPreflight } from './identity-buckets.ts';

describe('planBucketPreflight (CAP-3 capture preflight)', () => {
  it('names the two identity buckets the plugin reads, life registry first', () => {
    expect(IDENTITY_BUCKETS).toEqual(['geldar-life-registry', 'geldar-skins']);
  });

  it('skips the creation when both buckets already open', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', true],
      ['geldar-skins', true],
    ]);
    expect(plan.missing).toEqual([]);
    expect(plan.message).toBe(
      'identity buckets geldar-life-registry, geldar-skins already present: skipped',
    );
  });

  it('creates only the missing bucket and says which one was already there', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', true],
      ['geldar-skins', false],
    ]);
    expect(plan.missing).toEqual(['geldar-skins']);
    expect(plan.message).toBe(
      'identity buckets: creating geldar-skins (already present: geldar-life-registry)',
    );
  });

  it('creates both, in plugin order, on a fresh volume', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', false],
      ['geldar-skins', false],
    ]);
    expect(plan.missing).toEqual(['geldar-life-registry', 'geldar-skins']);
    expect(plan.message).toBe('identity buckets: creating geldar-life-registry, geldar-skins');
  });

  it('keeps a present bucket out of the creation list, whatever the order of the input', () => {
    const plan = planBucketPreflight([
      ['geldar-skins', false],
      ['geldar-life-registry', true],
    ]);
    expect(plan.missing).toEqual(['geldar-skins']);
  });
});
