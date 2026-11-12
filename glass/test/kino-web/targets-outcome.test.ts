import { describe, expect, it } from 'vitest';
import { parseRetryAfter, targetsFetchFailed, targetsOutcome } from '../../web/kino/targets.ts';

describe('targetsOutcome', () => {
  it('parses a good reply', () => {
    const o = targetsOutcome(200, null, { signed_in: false, enabled: true, agents: ['ag_a'] });
    expect(o).toEqual({
      ok: true,
      targets: { enabled: true, signedIn: false, agents: [{ id: 'ag_a', label: 'ag_a' }] },
    });
  });

  it('turns a 429 into a visible failure that carries Retry-After', () => {
    const o = targetsOutcome(429, '7', { error: { code: 'rate_limited' } });
    expect(o).toEqual({
      ok: false,
      message: 'Could not load the camera list (HTTP 429). Retry',
      retryAfterSeconds: 7,
    });
  });

  it('turns a 5xx, and an unreadable 200, into failures', () => {
    expect(targetsOutcome(503, null, null)).toMatchObject({ ok: false, retryAfterSeconds: null });
    expect(targetsOutcome(200, null, null).ok).toBe(false);
  });

  it('reports a thrown request', () => {
    expect(targetsFetchFailed().ok).toBe(false);
  });

  it('reads Retry-After as whole seconds only, capped', () => {
    expect(parseRetryAfter('3')).toBe(3);
    expect(parseRetryAfter('999999')).toBeNull();
    expect(parseRetryAfter('99999')).toBe(3600);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
