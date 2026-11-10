import { describe, expect, it } from 'vitest';
import { derivedCaps } from '../config.ts';
import { bucketRules, tokenBucketLimiter } from '../main.ts';
import type { RateDecision, RateLimiter } from '../ports.ts';
import { FrontLimits, ownerShare } from './limits.ts';

const LIMITS = {
  callsPerMinute: 60,
  ownerCallsPerMinute: 600,
  failedAuthPerMinute: 30,
  handshakePerMinute: 300,
  actMinSeconds: 0,
  sayMinSeconds: 0,
  journalMinSeconds: 5,
};
const OWNER_CAP = 20;
const OWNER = 'owner-1';
const ADDRESS = '203.0.113.7';

/** A real token bucket table, sized by the production rules, so the shares are the shipped numbers. */
function realLimits(): FrontLimits {
  return new FrontLimits(
    tokenBucketLimiter(bucketRules(LIMITS, OWNER_CAP)),
    ownerShare(LIMITS.ownerCallsPerMinute, OWNER_CAP),
  );
}

/** Records each take in order; a bucket for which `isEmpty` is true refuses. */
class RecordingLimiter implements RateLimiter {
  readonly taken: string[] = [];
  private readonly isEmpty: (bucket: string) => boolean;

  constructor(isEmpty: (bucket: string) => boolean) {
    this.isEmpty = isEmpty;
  }

  take(bucket: string): RateDecision {
    this.taken.push(bucket);
    return this.peek(bucket);
  }

  peek(bucket: string): RateDecision {
    return this.isEmpty(bucket)
      ? { allowed: false, retryAfterMs: 1500 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

describe('twenty agents of one owner behind one address', () => {
  it('hold four open requests each, and the address and owner caps admit all eighty', () => {
    const caps = derivedCaps(OWNER_CAP);
    const limits = realLimits();
    for (let agent = 0; agent < 20; agent++) {
      for (let slot = 0; slot < 4; slot++) {
        expect(limits.acquireAddress(ADDRESS, caps.perAddress)).toBe(true);
        expect(limits.acquireOwner(OWNER, caps.perAddress)).toBe(true);
        expect(limits.acquire(`agent-${agent}`)).toBe(true);
      }
    }
    expect(limits.acquireAddress(ADDRESS, caps.perAddress)).toBe(false);
    expect(limits.acquireOwner(OWNER, caps.perAddress)).toBe(false);
  });

  it('frees an owner slot when a request closes', () => {
    const limits = realLimits();
    for (let i = 0; i < 3; i++) expect(limits.acquireOwner(OWNER, 3)).toBe(true);
    expect(limits.acquireOwner(OWNER, 3)).toBe(false);
    limits.releaseOwner(OWNER);
    expect(limits.acquireOwner(OWNER, 3)).toBe(true);
  });
});

describe('owner-first call order', () => {
  it('an owner refusal takes no token at all', () => {
    const limiter = new RecordingLimiter((bucket) => bucket === `owner:${OWNER}`);
    const limits = new FrontLimits(limiter);
    expect(limits.call('agent-0', OWNER, 0)).toBeDefined();
    expect(limiter.taken).toEqual([]);
  });

  it('takes the owner token before the player token on a served call', () => {
    const limiter = new RecordingLimiter(() => false);
    const limits = new FrontLimits(limiter);
    expect(limits.call('agent-0', OWNER, 0)).toBeUndefined();
    expect(limiter.taken.indexOf(`owner:${OWNER}`)).toBeLessThan(
      limiter.taken.indexOf('player:agent-0'),
    );
  });
});

describe('per-agent reserved share of the owner bucket', () => {
  it('splits the owner rate across the owner cap', () => {
    const rule = bucketRules(LIMITS, OWNER_CAP);
    expect(rule(`owner-agent:${OWNER}:agent-0`)).toEqual({ capacity: 30, perMinute: 30 });
    expect(rule(`owner:${OWNER}`)).toEqual({ capacity: 600, perMinute: 600 });
  });

  it('gives a lone agent its full player rate, past its share, while the pool has room', () => {
    const limits = realLimits();
    let served = 0;
    for (let i = 0; i < 100; i++) if (limits.call('lone', OWNER, 0) === undefined) served++;
    expect(served).toBe(60);
  });

  it('refuses a noisy agent past its share while siblings are active, so they keep theirs', () => {
    const limits = realLimits();
    // Nineteen siblings each make one call, so each holds a share of the pool from now on.
    for (let sibling = 0; sibling < 19; sibling++) {
      expect(limits.call(`sibling-${sibling}`, OWNER, 0)).toBeUndefined();
    }
    let noisyServed = 0;
    for (let i = 0; i < 100; i++) if (limits.call('noisy', OWNER, 0) === undefined) noisyServed++;
    expect(noisyServed).toBe(30);
    // The pool now holds exactly the 19 siblings' unused shares: 19 times 29.
    for (let sibling = 0; sibling < 19; sibling++) {
      for (let i = 1; i < 30; i++) {
        expect(limits.call(`sibling-${sibling}`, OWNER, 0)).toBeUndefined();
      }
    }
  });

  it('stops reserving for siblings that have been quiet for a minute', () => {
    const limits = realLimits();
    for (let sibling = 0; sibling < 19; sibling++) limits.call(`sibling-${sibling}`, OWNER, 0);
    // A minute later the pool and the buckets have refilled and the siblings no longer count.
    let served = 0;
    for (let i = 0; i < 100; i++) {
      if (limits.call('noisy', OWNER, 61_000) === undefined) served++;
    }
    expect(served).toBe(60);
  });

  it('keeps the owner rate when no cap is given', () => {
    expect(bucketRules(LIMITS)(`owner-agent:${OWNER}:agent-0`)).toEqual({
      capacity: 600,
      perMinute: 600,
    });
  });
});
