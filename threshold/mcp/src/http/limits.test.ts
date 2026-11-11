import { describe, expect, it } from 'vitest';
import type { RateDecision, RateLimiter } from '../ports.ts';
import { FrontLimits, MAX_LOOKUPS_IN_FLIGHT } from './limits.ts';

const CAP = 2;

/** Only the failed-auth address buckets are capped, at CAP each; every other bucket allows. */
class AddressCapLimiter implements RateLimiter {
  private readonly used = new Map<string, number>();

  take(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    if (used >= capOf(bucket)) return { allowed: false, retryAfterMs: 1500 };
    this.used.set(bucket, used + 1);
    return { allowed: true, retryAfterMs: 0 };
  }

  peek(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    return used >= capOf(bucket)
      ? { allowed: false, retryAfterMs: 1500 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

function capOf(bucket: string): number {
  return bucket.startsWith('auth-failed:address:') ? CAP : Number.POSITIVE_INFINITY;
}

/** Spends the address's failed-auth allowance, so authBlocked refuses it from then on. */
function exhaust(limits: FrontLimits, address: string): void {
  for (let i = 0; i < CAP; i++) expect(limits.failedAuth(address, 0)).toBeUndefined();
}

describe('failed-auth bucket key', () => {
  it('shares one bucket between two addresses in the same /64', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    exhaust(limits, '2001:db8:1:2::1');
    expect(limits.authBlocked('2001:db8:1:2:ffff:ffff:ffff:ffff', 0)).toBeDefined();
  });

  it('keeps different /64 prefixes in different buckets', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    exhaust(limits, '2001:db8:1:2::1');
    expect(limits.authBlocked('2001:db8:1:3::1', 0)).toBeUndefined();
  });

  it('keys an IPv4-mapped IPv6 address as the IPv4 address it wraps', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    exhaust(limits, '::ffff:203.0.113.5');
    expect(limits.authBlocked('203.0.113.5', 0)).toBeDefined();
    expect(limits.authBlocked('::ffff:203.0.113.5', 0)).toBeDefined();
  });
});

/** Only the global failed-auth bucket is capped, at CAP; every address bucket allows. */
class GlobalCapLimiter implements RateLimiter {
  private used = 0;

  take(bucket: string): RateDecision {
    if (bucket !== 'auth-failed:global') return { allowed: true, retryAfterMs: 0 };
    if (this.used >= CAP) return { allowed: false, retryAfterMs: 1500 };
    this.used += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  peek(bucket: string): RateDecision {
    if (bucket !== 'auth-failed:global' || this.used < CAP)
      return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: 1500 };
  }
}

describe('no global failed-auth gate (R24)', () => {
  it('does not block a fresh address or fail a request when the global bucket is empty', () => {
    const limits = new FrontLimits(new GlobalCapLimiter());
    for (let i = 1; i <= 5; i++) {
      expect(limits.failedAuth(`198.51.100.${i}`, 0)).toBeUndefined();
    }
    expect(limits.authBlocked('198.51.100.9', 0)).toBeUndefined();
  });
});

describe('in-flight lookup cap', () => {
  it('allows 16 lookups and refuses the 17th', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) expect(limits.acquireLookup()).toBe(true);
    expect(limits.acquireLookup()).toBe(false);
  });

  it('gives a slot back on release, and never counts below zero', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) limits.acquireLookup();
    limits.releaseLookup();
    expect(limits.acquireLookup()).toBe(true);
    expect(limits.acquireLookup()).toBe(false);
    const fresh = new FrontLimits(new AddressCapLimiter());
    fresh.releaseLookup();
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) expect(fresh.acquireLookup()).toBe(true);
    expect(fresh.acquireLookup()).toBe(false);
  });
});

describe('effective-address slot key', () => {
  it('counts two addresses in the same /64 against one cap', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    expect(limits.acquireAddress('2001:db8:1:2::1', 1)).toBe(true);
    expect(limits.acquireAddress('2001:db8:1:2::9', 1)).toBe(false);
    expect(limits.acquireAddress('2001:db8:1:3::1', 1)).toBe(true);
  });

  it('counts an IPv4-mapped address against the plain IPv4 address', () => {
    const limits = new FrontLimits(new AddressCapLimiter());
    expect(limits.acquireAddress('::ffff:203.0.113.5', 1)).toBe(true);
    expect(limits.acquireAddress('203.0.113.5', 1)).toBe(false);
    limits.releaseAddress('203.0.113.5');
    expect(limits.acquireAddress('203.0.113.5', 1)).toBe(true);
  });
});
