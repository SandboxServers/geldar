import { describe, expect, it } from 'vitest';
import { attemptOf, type WakeAttempt, type WakeClock, waitForWake } from './live-wake.ts';

const WAKING: WakeAttempt = { ok: false, code: 'body_unavailable', message: 'the Body is not up' };
const OK: WakeAttempt = { ok: true };

/** A clock that starts at 0 and advances only when the helper sleeps; `sleeps` records each pause. */
function fakeClock(): { clock: WakeClock; sleeps: number[]; now: () => number } {
  let time = 0;
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => time,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        time += ms;
      },
    },
    sleeps,
    now: () => time,
  };
}

/** Answers the given results in order, then repeats the last one. `calls` counts the looks. */
function scripted(results: WakeAttempt[]): {
  attempt: () => Promise<WakeAttempt>;
  calls: () => number;
} {
  let calls = 0;
  return {
    attempt: async () => {
      const result = results[Math.min(calls, results.length - 1)];
      calls += 1;
      if (result === undefined) throw new Error('no scripted result');
      return result;
    },
    calls: () => calls,
  };
}

describe('waitForWake', () => {
  it('succeeds on the third try, after pauses of 2 s and 4 s', async () => {
    const fake = fakeClock();
    const looks = scripted([WAKING, WAKING, OK]);
    const report = await waitForWake({ attempt: looks.attempt, clock: fake.clock });
    expect(report).toEqual({ attempts: 3, waitedMs: 6_000 });
    expect(looks.calls()).toBe(3);
    expect(fake.sleeps).toEqual([2_000, 4_000]);
  });

  it('succeeds at once when the first look answers, with no pause', async () => {
    const fake = fakeClock();
    const report = await waitForWake({ attempt: scripted([OK]).attempt, clock: fake.clock });
    expect(report).toEqual({ attempts: 1, waitedMs: 0 });
    expect(fake.sleeps).toEqual([]);
  });

  it('fails fast on a failure that is not body_unavailable, with its message', async () => {
    const fake = fakeClock();
    const looks = scripted([WAKING, { ok: false, code: 'forbidden', message: 'not your life' }]);
    await expect(waitForWake({ attempt: looks.attempt, clock: fake.clock })).rejects.toThrow(
      'look failed during the wake phase: forbidden: not your life',
    );
    expect(looks.calls()).toBe(2);
    expect(fake.sleeps).toEqual([2_000]);
  });

  it('fails on the first look when that look is not body_unavailable', async () => {
    const fake = fakeClock();
    const looks = scripted([{ ok: false, code: 'unauthorized', message: 'bad token' }]);
    await expect(waitForWake({ attempt: looks.attempt, clock: fake.clock })).rejects.toThrow(
      'unauthorized: bad token',
    );
    expect(looks.calls()).toBe(1);
    expect(fake.sleeps).toEqual([]);
  });

  it('backs off 2, 4, 8, then 10 s each, and cuts the last pause to the deadline', async () => {
    const fake = fakeClock();
    await expect(
      waitForWake({ attempt: scripted([WAKING]).attempt, clock: fake.clock }),
    ).rejects.toThrow();
    expect(fake.sleeps).toEqual([2_000, 4_000, 8_000, ...Array(10).fill(10_000), 6_000]);
    expect(fake.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(120_000);
  });

  it('times out at the deadline with the last look made at that instant', async () => {
    const fake = fakeClock();
    const looks = scripted([WAKING]);
    await expect(waitForWake({ attempt: looks.attempt, clock: fake.clock })).rejects.toThrow(
      'did not answer look within 120 s (15 tries, last: body_unavailable)',
    );
    expect(fake.now()).toBe(120_000);
    expect(looks.calls()).toBe(15);
  });

  it('names the presence state in the timeout, and tells the operator where to look', async () => {
    const fake = fakeClock();
    const failure = waitForWake({
      attempt: scripted([WAKING]).attempt,
      clock: fake.clock,
      deadlineMs: 4_000,
      describeState: () => 'The presence record is hibernating.',
    });
    await expect(failure).rejects.toThrow('The presence record is hibernating.');
    await expect(
      waitForWake({
        attempt: scripted([WAKING]).attempt,
        clock: fakeClock().clock,
        deadlineMs: 0,
        describeState: () => {
          throw new Error('no NATS');
        },
      }),
    ).rejects.toThrow('The presence record could not be read.');
    await expect(
      waitForWake({ attempt: scripted([WAKING]).attempt, clock: fakeClock().clock, deadlineMs: 0 }),
    ).rejects.toThrow('./geldar.ps1 players logs');
  });
});

describe('attemptOf', () => {
  it('reads a result that is not an error as ok', () => {
    expect(attemptOf({ isError: false, content: [{ type: 'text', text: 'a view' }] })).toEqual(OK);
    expect(attemptOf({})).toEqual(OK);
  });

  it('reads the code before the colon of a tool error text', () => {
    expect(
      attemptOf({
        isError: true,
        content: [{ type: 'text', text: 'body_unavailable: the Body is not up' }],
      }),
    ).toEqual({ ok: false, code: 'body_unavailable', message: 'the Body is not up' });
  });

  it('reads a tool error without the code form as unknown, with its text', () => {
    expect(attemptOf({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toEqual({
      ok: false,
      code: 'unknown',
      message: 'boom',
    });
    expect(attemptOf({ isError: true })).toEqual({ ok: false, code: 'unknown', message: '' });
  });
});
