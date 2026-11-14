import { describe, expect, it } from 'vitest';
import { shutdownHelper, shutdownOnce } from './shutdown.ts';

/** Shutdown steps that count each close; `stopIntake` can be made to throw. */
function steps(options: { stopIntakeThrows?: boolean } = {}) {
  const calls = { stopIntake: 0, closeConnection: 0, closePool: 0 };
  return {
    calls,
    steps: {
      stopSweep: () => undefined,
      stopIntake: () => {
        calls.stopIntake++;
        if (options.stopIntakeThrows) throw new Error('unsubscribe failed');
      },
      serving: Promise.resolve(),
      closeConnection: async () => {
        calls.closeConnection++;
      },
      closePool: async () => {
        calls.closePool++;
      },
    },
  };
}

describe('shutdownOnce', () => {
  it('a second call returns the same promise and does not run the shutdown again', async () => {
    let runs = 0;
    const once = shutdownOnce(async () => {
      runs++;
    });
    const first = once();
    const second = once();
    expect(second).toBe(first);
    await first;
    expect(runs).toBe(1);
  });

  it('a call after the shutdown has finished still runs nothing', async () => {
    let runs = 0;
    const once = shutdownOnce(async () => {
      runs++;
    });
    await once();
    await once();
    expect(runs).toBe(1);
  });

  it('a double shutdown closes the connection and the pool once', async () => {
    const { calls, steps: s } = steps();
    const once = shutdownOnce(() => shutdownHelper(s, 10));
    await Promise.all([once(), once()]);
    expect(calls).toEqual({ stopIntake: 1, closeConnection: 1, closePool: 1 });
  });

  it('a throwing stopIntake still closes the connection and the pool', async () => {
    const { calls, steps: s } = steps({ stopIntakeThrows: true });
    await shutdownHelper(s, 10);
    expect(calls.closeConnection).toBe(1);
    expect(calls.closePool).toBe(1);
  });

  it('a throwing stopIntake inside shutdownOnce still closes once and resolves', async () => {
    const { calls, steps: s } = steps({ stopIntakeThrows: true });
    const once = shutdownOnce(() => shutdownHelper(s, 10));
    await once();
    await once();
    expect(calls).toEqual({ stopIntake: 1, closeConnection: 1, closePool: 1 });
  });
});
