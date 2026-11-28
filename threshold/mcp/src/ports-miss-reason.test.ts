import { describe, expect, it } from 'vitest';
import type { MissReason } from './ports.ts';
import { REFUSAL_REASONS } from './ports.ts';

// The reasons a token store may explain for a miss: the token lookup and `internal`, nothing the front door alone adds.
const MISS_REASONS = [
  'unknown_token',
  'token_revoked',
  'token_expired',
  'player_not_active',
  'harness_disabled',
  'owner_retired',
  'owner_over_cap',
  'internal',
] as const;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('MissReason', () => {
  it('is exactly the token-lookup reasons and internal (type level)', () => {
    const exact: Equal<MissReason, (typeof MISS_REASONS)[number]> = true;
    expect(exact).toBe(true);
  });

  it('names only reasons the refusal list has', () => {
    for (const reason of MISS_REASONS) {
      expect(REFUSAL_REASONS).toContain(reason);
    }
  });
});
