import { describe, expect, it } from 'vitest';
import { bestEffortPresence, rateLimitedPresenceLog } from './presence-write.ts';

const fail = async (): Promise<void> => {
  throw new Error('nats down');
};

describe('rateLimitedPresenceLog', () => {
  it('turns 30 failing presence writes within a minute into one log line', async () => {
    let now = 0;
    const lines: Record<string, unknown>[] = [];
    const log = rateLimitedPresenceLog((line) => lines.push(line), () => now);
    for (let i = 0; i < 30; i++) await bestEffortPresence(log, fail);
    expect(lines).toEqual([{ event: 'presence_error', cause: 'Error: nats down' }]);
  });

  it('logs once more after a minute, with the 29 lines suppressed since the last one', async () => {
    let now = 0;
    const lines: Record<string, unknown>[] = [];
    const log = rateLimitedPresenceLog((line) => lines.push(line), () => now);
    for (let i = 0; i < 30; i++) await bestEffortPresence(log, fail);
    now = 60_000;
    await bestEffortPresence(log, fail);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      event: 'presence_error',
      cause: 'Error: nats down',
      suppressed: 29,
    });
  });

  it('limits settle_error on its own kind, so a settle fault is logged even during a presence fault', () => {
    let now = 0;
    const lines: Record<string, unknown>[] = [];
    const log = rateLimitedPresenceLog((line) => lines.push(line), () => now);
    log({ event: 'presence_error', cause: 'a' });
    log({ event: 'presence_error', cause: 'a' });
    log({ event: 'settle_error', cause: 'b' });
    now = 1_000;
    log({ event: 'settle_error', cause: 'b' });
    expect(lines).toEqual([
      { event: 'presence_error', cause: 'a' },
      { event: 'settle_error', cause: 'b' },
    ]);
  });

  it('passes lines of other events through unchanged and unlimited', () => {
    const lines: Record<string, unknown>[] = [];
    const log = rateLimitedPresenceLog((line) => lines.push(line), () => 0);
    log({ event: 'unhandled', cause: 'x' });
    log({ event: 'unhandled', cause: 'x' });
    expect(lines).toHaveLength(2);
  });
});
