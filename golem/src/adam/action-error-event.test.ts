import { MAX_ERROR_TEXT_CHARS } from '@geldar/telemetry';
import { describe, expect, it } from 'vitest';
import { FAIL_REASONS, type FailReason } from '../actions/outcome.ts';
import { actionErrorAttributes } from './action-error-event.ts';

/** Fails to compile when `FailReason` gains a member the table lacks, or the reverse. */
const EXPECTED: Record<FailReason, true> = {
  invalid_args: true,
  timeout: true,
  blocked: true,
  not_found: true,
  out_of_reach: true,
  missing_materials: true,
  missing_station: true,
  needs_rescue: true,
  not_possible: true,
  state_unachievable: true,
  interrupted: true,
  unsupported: true,
  busy: true,
  no_effect: true,
  internal: true,
};

describe('actionErrorAttributes', () => {
  it('knows exactly the FailReason members, and keeps each as its own label', () => {
    expect([...FAIL_REASONS].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const reason of FAIL_REASONS) {
      expect(actionErrorAttributes({ status: 'failed', reason, message: 'm' })?.reason).toBe(
        reason,
      );
    }
  });

  it('cuts a message above the cap before scrubbing and marks the cut', () => {
    const extra = 5000;
    const message = `${'word '.repeat(MAX_ERROR_TEXT_CHARS / 5)}${'z'.repeat(extra)}`;
    const attrs = actionErrorAttributes({ status: 'failed', reason: 'internal', message });
    const text = String(attrs?.['geldar.content.error']);
    expect(text).not.toContain('zzzz');
    // The package cap (32 KiB) cuts the stored text; `.bytes` is the size of what was scrubbed.
    expect(attrs?.['geldar.content.error.truncated']).toBe(true);
    expect(Number(attrs?.['geldar.content.error.bytes'])).toBeLessThan(MAX_ERROR_TEXT_CHARS + 100);
  });

  it('a message at the cap is not marked', () => {
    const message = 'a '.repeat(MAX_ERROR_TEXT_CHARS / 2);
    const attrs = actionErrorAttributes({ status: 'failed', reason: 'internal', message });
    expect(String(attrs?.['geldar.content.error'])).not.toContain('truncated');
  });

  it.each([100_000, 1024 * 1024])(
    'a hostile %i-character message is handled in under 100 ms',
    (n) => {
      for (const message of [
        'a'.repeat(n),
        `x://${'a'.repeat(n)}`,
        'Authorization'.repeat(n / 13),
      ]) {
        const started = performance.now();
        const attrs = actionErrorAttributes({ status: 'failed', reason: 'internal', message });
        expect(performance.now() - started).toBeLessThan(100);
        expect(attrs?.reason).toBe('internal');
      }
    },
  );
});
