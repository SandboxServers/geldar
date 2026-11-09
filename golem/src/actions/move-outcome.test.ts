import { describe, expect, it } from 'vitest';
import { outcomeOfMove } from './move-outcome.ts';

describe('outcomeOfMove', () => {
  it('maps a cancelled walk to a cancelled outcome and keeps the detail', () => {
    const outcome = outcomeOfMove(
      { ok: false, reason: 'cancelled', message: 'move cancelled' },
      { mined: 2 },
    );
    expect(outcome).toEqual({ status: 'cancelled', detail: { mined: 2 } });
  });

  it.each(['blocked', 'timeout', 'interrupted'] as const)(
    'maps a %s walk to a failure with the same reason and message',
    (reason) => {
      const outcome = outcomeOfMove({ ok: false, reason, message: `walk ${reason}` });
      expect(outcome).toEqual({
        status: 'failed',
        reason,
        message: `walk ${reason}`,
        detail: {},
      });
    },
  );
});
