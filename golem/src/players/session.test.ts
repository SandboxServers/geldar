import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { RunningAdamBody } from '../adam/adam-body.ts';
import { type PlayerConnection, PlayerSession } from './session.ts';

const LIFE = 'ag_jason_01';

/** A bot source that resolves at once; `closes` counts the connections that were closed. */
function fakeConnect(calls: string[], closes: { count: number }): PlayerConnection {
  calls.push('connect');
  return {
    acquire: async () => ({}) as Bot,
    close: async () => {
      closes.count++;
    },
  };
}

/** A Body run that lasts until the supervisor stops it. The generation is the one restart gives. */
function runFor(generation: number): RunningAdamBody {
  return {
    lifeId: LIFE,
    generation,
    outcome: { kind: 'resumed', intentId: 'int_test_01' } as RunningAdamBody['outcome'],
    body: {} as RunningAdamBody['body'],
    ended: new Promise<string>(() => undefined),
    fail: () => undefined,
    stop: async () => undefined,
  };
}

function setup(
  admit: (lifeId: string) => Promise<void> = async () => undefined,
  body?: () => Promise<RunningAdamBody>,
) {
  const calls: string[] = [];
  const closes = { count: 0 };
  const logs: Record<string, unknown>[] = [];
  let generation = 0;
  const session = new PlayerSession({
    lifeId: LIFE,
    admit: async (lifeId) => {
      calls.push(`admit ${lifeId}`);
      await admit(lifeId);
    },
    connect: () => fakeConnect(calls, closes),
    body: body ?? (async () => runFor(++generation)),
    log: (line) => logs.push(line),
  });
  return { session, calls, closes, logs };
}

describe('PlayerSession', () => {
  it('whitelists the life before it connects', async () => {
    const { session, calls } = setup();
    await session.up();
    expect(calls.slice(0, 2)).toEqual([`admit ${LIFE}`, 'connect']);
    await session.down();
  });

  it('starts no connection when the whitelist fails, and logs why', async () => {
    const { session, calls, logs } = setup(async () => {
      throw new Error('rcon refused');
    });
    await session.up();
    expect(calls).toEqual([`admit ${LIFE}`]);
    expect(session.running).toBe(false);
    expect(logs.some((line) => line.event === 'whitelist_failed')).toBe(true);
  });

  it('up, down, up runs generations 1 and 2 on two connections', async () => {
    const { session, logs, closes } = setup();
    await session.up();
    await vi.waitFor(() => expect(logs.some((l) => l.event === 'body_started')).toBe(true));
    await session.down();
    expect(session.running).toBe(false);
    expect(closes.count).toBe(1);

    await session.up();
    await vi.waitFor(() => expect(logs.filter((l) => l.event === 'body_started')).toHaveLength(2));
    await session.down();

    const generations = logs
      .filter((l) => l.event === 'body_started')
      .map((l) => l.body_generation);
    expect(generations).toEqual([1, 2]);
    expect(closes.count).toBe(2);
  });

  it('a down during a slow Body start ends without waiting for the bot', async () => {
    // The Body start resolves only after `down` was called, as a real start can.
    const starts: ((run: RunningAdamBody) => void)[] = [];
    const { session, logs, closes } = setup(undefined, () => {
      return new Promise<RunningAdamBody>((resolve) => starts.push(resolve));
    });
    await session.up();
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    const stopping = session.down();
    starts[0]?.(runFor(1));
    await stopping;
    expect(session.running).toBe(false);
    expect(closes.count).toBe(1);
    expect(logs.some((line) => line.event === 'player_down')).toBe(true);
  });

  it('ignores a second up while a session runs, and a down while idle', async () => {
    const { session, calls } = setup();
    await session.down();
    await session.up();
    await session.up();
    expect(calls.filter((call) => call === 'connect')).toHaveLength(1);
    await session.down();
  });
});
