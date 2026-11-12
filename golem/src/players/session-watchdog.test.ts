import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningAdamBody } from '../adam/adam-body.ts';
import { PlayerSession } from './session.ts';

const LIFE = 'ag_jason_01';
const LIMIT = 60_000;

/** A wedged player host: the bot's tick and position never change; `fail` ends the run. */
function setup(options: { watchdog: boolean }) {
  let nowMs = 1_000_000;
  const logs: Record<string, unknown>[] = [];
  const fires: (() => void)[] = [];
  const cancelled: boolean[] = [];
  let generation = 0;
  const body = async (): Promise<RunningAdamBody> => {
    let end: (reason: string) => void = () => undefined;
    const ended = new Promise<string>((resolve) => {
      end = resolve;
    });
    return {
      lifeId: LIFE,
      generation: ++generation,
      outcome: { kind: 'resumed', intentId: 'int_test_01' } as RunningAdamBody['outcome'],
      body: {} as RunningAdamBody['body'],
      ended,
      fail: end,
      stop: async () => undefined,
    };
  };
  const session = new PlayerSession({
    lifeId: LIFE,
    admit: async () => undefined,
    connect: () => ({ acquire: async () => ({}) as Bot, close: async () => undefined }),
    body,
    log: (line) => logs.push(line),
    ...(options.watchdog
      ? {
          watchdog: {
            limitMs: LIMIT,
            now: () => nowMs,
            sample: () => ({ tick: 100, position: '1,2,3' }),
            every: (fire: () => void) => {
              fires.push(fire);
              const at = cancelled.push(false) - 1;
              return () => {
                cancelled[at] = true;
              };
            },
          },
        }
      : {}),
  });
  /** Moves the clock, polls the current run's watchdog, and lets the restart and its backoff finish. */
  const stall = async (ms: number): Promise<void> => {
    nowMs += ms;
    fires.at(-1)?.();
    await vi.advanceTimersByTimeAsync(10_000);
  };
  const started = (): number => logs.filter((l) => l.event === 'body_started').length;
  return { session, logs, stall, started, fires };
}

describe('the player host wedge watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('restarts a frozen bot once, on the same life, with the next generation', async () => {
    const { session, logs, stall, started } = setup({ watchdog: true });
    await session.up();
    await vi.advanceTimersByTimeAsync(0);
    expect(started()).toBe(1);

    await stall(LIMIT - 1);
    expect(started()).toBe(1);
    await stall(1);
    expect(started()).toBe(2);

    const restarts = logs.filter((l) => l.event === 'body_watchdog' && l.action === 'restart');
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ life_id: LIFE, body_generation: 1, state: 'waking' });
    expect(logs.filter((l) => l.event === 'body_started').map((l) => l.life_id)).toEqual([
      LIFE,
      LIFE,
    ]);
    await session.down();
  });

  it('backs off by doubling the stall, then caps at 3 restarts with body_unavailable wedged', async () => {
    const { session, logs, stall, started } = setup({ watchdog: true });
    await session.up();
    await vi.advanceTimersByTimeAsync(0);

    await stall(LIMIT); // restart 1
    expect(started()).toBe(2);
    await stall(LIMIT); // too early for restart 2: needs 2x
    expect(started()).toBe(2);
    await stall(LIMIT); // restart 2
    expect(started()).toBe(3);
    await stall(LIMIT * 3); // not yet 4x
    expect(started()).toBe(3);
    await stall(LIMIT); // restart 3
    expect(started()).toBe(4);

    await stall(LIMIT); // at the cap: no restart
    await stall(LIMIT); // and one report per stall
    expect(started()).toBe(4);
    const wedged = logs.filter((l) => l.event === 'body_unavailable');
    expect(wedged).toEqual([{ event: 'body_unavailable', reason: 'wedged', life_id: LIFE }]);
    expect(logs.filter((l) => l.event === 'body_watchdog').map((l) => l.action)).toEqual([
      'restart',
      'restart',
      'restart',
      'capped',
    ]);
    await session.down();
  });

  it('detaches the watchdog of a run that ended', async () => {
    const { session, stall, fires, started } = setup({ watchdog: true });
    await session.up();
    await vi.advanceTimersByTimeAsync(0);
    await stall(LIMIT);
    expect(fires).toHaveLength(2);
    expect(started()).toBe(2);
    await session.down();
  });

  it('without the watchdog option nothing restarts a frozen bot (the default is on in main)', async () => {
    const { session, stall, started } = setup({ watchdog: false });
    await session.up();
    await vi.advanceTimersByTimeAsync(0);
    await stall(LIMIT * 10);
    expect(started()).toBe(1);
    await session.down();
  });
});
