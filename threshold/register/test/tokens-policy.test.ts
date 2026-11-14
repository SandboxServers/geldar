import { describe, expect, it } from 'vitest';
import {
  graceEndsAt,
  ROTATE_GRACE_MS,
  renewalDue,
  TOKEN_LIFETIME_MS,
  tokenExpiresAt,
  tokenUsable,
} from '../src/tokens-policy.ts';

const DAY = 24 * 60 * 60 * 1000;
const SEC = 1000;
const issued = new Date('2026-01-01T00:00:00.000Z');
const expires = tokenExpiresAt(issued);

describe('token lifetime (decision 0170, C7-02a)', () => {
  it('is 90 days from issue', () => {
    expect(TOKEN_LIFETIME_MS).toBe(90 * DAY);
    expect(expires.getTime() - issued.getTime()).toBe(90 * DAY);
  });
});

describe('expiry boundary', () => {
  it('refuses a token at its expiry second', () => {
    expect(tokenUsable(expires, null, expires)).toBe(false);
  });

  it('accepts a token one second before its expiry', () => {
    expect(tokenUsable(expires, null, new Date(expires.getTime() - SEC))).toBe(true);
  });

  it('refuses a revoked token even before its expiry', () => {
    expect(tokenUsable(expires, issued, issued)).toBe(false);
  });
});

describe('renewal flag boundary', () => {
  it('is false at day 75', () => {
    expect(renewalDue(expires, new Date(issued.getTime() + 75 * DAY))).toBe(false);
  });

  it('is false one second before the 14 day mark', () => {
    expect(renewalDue(expires, new Date(expires.getTime() - 14 * DAY - SEC))).toBe(false);
  });

  it('is true at exactly 14 days before expiry', () => {
    expect(renewalDue(expires, new Date(expires.getTime() - 14 * DAY))).toBe(true);
  });

  it('stays true after the warning starts', () => {
    expect(renewalDue(expires, new Date(expires.getTime() - SEC))).toBe(true);
  });
});

describe('rotate grace (10 minutes)', () => {
  const rotated = new Date('2026-03-01T12:00:00.000Z');

  it('is the 10 minute grace the operator CLI uses', () => {
    expect(ROTATE_GRACE_MS).toBe(10 * 60 * SEC);
  });

  it('accepts the old token one second before the grace ends', () => {
    const end = graceEndsAt(rotated);
    expect(tokenUsable(end, null, new Date(end.getTime() - SEC))).toBe(true);
  });

  it('refuses the old token at 10 minutes and one second', () => {
    const end = graceEndsAt(rotated);
    expect(tokenUsable(end, null, new Date(rotated.getTime() + 10 * 60 * SEC + SEC))).toBe(false);
  });
});
