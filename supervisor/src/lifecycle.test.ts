import { describe, expect, it } from 'vitest';
import { unexpectedEndLine } from './lifecycle.ts';
import type { CtlStats } from './nats.ts';

const stats: CtlStats = {
  dropped: 1,
  invalid: 2,
  busy: 3,
  handlerFailed: 4,
  replyFailed: 5,
  subscribeFailed: 6,
};

describe('unexpectedEndLine (the control subscription ended)', () => {
  it('a drain during a stop is expected: no line', () => {
    expect(unexpectedEndLine(true, stats)).toBeNull();
  });

  it('an end while running is unexpected and names every counter', () => {
    expect(unexpectedEndLine(false, stats)).toBe(
      'supervisor: control subscription ended unexpectedly dropped=1 invalid=2 busy=3 handlerFailed=4 replyFailed=5 subscribeFailed=6',
    );
  });

  it('a zero subscribeFailed still counts as an unexpected end', () => {
    const quiet = { ...stats, subscribeFailed: 0 };
    expect(unexpectedEndLine(false, quiet)).toContain('subscribeFailed=0');
  });
});
