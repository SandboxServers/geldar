import { EventEmitter } from 'node:events';
import type { Bot, BotOptions } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from './connection.ts';
import { stackVersions } from './versions.ts';

/** A bot stand-in: an emitter with a `quit` spy, so tests drive the lifecycle by hand. */
class FakeBot extends EventEmitter {
  quit = vi.fn();
}

/** Wires a manager to fake bots, a recorded sleep and a fake clock. */
function harness(stableMs?: number) {
  const bots: FakeBot[] = [];
  const sleeps: number[] = [];
  const clock = { t: 0 };
  const createBot = vi.fn((_o: BotOptions) => {
    const bot = new FakeBot();
    bots.push(bot);
    return bot as unknown as Bot;
  });
  const manager = new ConnectionManager({
    host: '127.0.0.1',
    port: 25565,
    username: 'GolemSmoke',
    createBot,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock.t,
    rng: () => 0.5,
    log: () => {},
    ...(stableMs === undefined ? {} : { stableMs }),
  });
  /** Waits until the manager has created at least `n` bots. */
  const waitForBots = (n: number) =>
    vi.waitFor(() => expect(bots.length).toBeGreaterThanOrEqual(n));
  return { bots, sleeps, clock, createBot, manager, waitForBots };
}

describe('ConnectionManager', () => {
  it('sleeps for the first three backoff delays after three ends in a row', async () => {
    const h = harness();
    const joined = h.manager.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await h.waitForBots(2);
    h.bots[1]?.emit('end', 'closed');
    await h.waitForBots(3);
    h.bots[2]?.emit('end', 'closed');
    await h.waitForBots(4);
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    await h.manager.stop();
  });

  it('resets the attempt counter after a session that lasted 10 s', async () => {
    const h = harness();
    const joined = h.manager.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await h.waitForBots(2);
    h.bots[1]?.emit('spawn');
    h.clock.t += 10_000;
    h.bots[1]?.emit('end', 'closed');
    await h.waitForBots(3);
    expect(h.sleeps).toEqual([1000, 1000]);
    expect(h.manager.attempt).toBe(1);
    await h.manager.stop();
  });

  it('does not reset the attempt counter after a session that lasted 1 s', async () => {
    const h = harness();
    const joined = h.manager.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await h.waitForBots(2);
    h.bots[1]?.emit('spawn');
    h.clock.t += 1000;
    h.bots[1]?.emit('end', 'closed');
    await h.waitForBots(3);
    expect(h.sleeps).toEqual([1000, 2000]);
    await h.manager.stop();
  });

  it('goes fatal on a whitelist kick and creates no further bot', async () => {
    const h = harness();
    const joined = h.manager.start();
    const outcome = expect(joined).rejects.toThrow(/not whitelisted/);
    h.bots[0]?.emit('kicked', 'You are not whitelisted on this server!', true);
    h.bots[0]?.emit('end', 'disconnect.whitelist');
    await outcome;
    expect(h.manager.state).toBe('fatal');
    expect(h.createBot).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('creates no new bot when stopped during a backoff sleep', async () => {
    const h = harness();
    const pendingForever = new ConnectionManager({
      host: '127.0.0.1',
      port: 25565,
      username: 'GolemSmoke',
      createBot: h.createBot,
      sleep: () => new Promise<void>(() => {}),
      now: () => h.clock.t,
      rng: () => 0.5,
      log: () => {},
    });
    const joined = pendingForever.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await vi.waitFor(() => expect(pendingForever.state).toBe('backoff'));
    await pendingForever.stop();
    expect(pendingForever.state).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.createBot).toHaveBeenCalledTimes(1);
    expect(h.bots[0]?.quit).toHaveBeenCalled();
  });
});

describe('stackVersions', () => {
  it('reports the versions pinned by decision 0022', () => {
    const versions = stackVersions();
    expect(versions.mineflayer).toBe('4.39.0');
    expect(versions.minecraftData).toBe('3.117.0');
    expect(versions.mineflayerPathfinder).toBe('2.4.5');
    expect(versions.vec3).toBe('0.1.10');
    expect(versions.testedVersions).toContain('26.1');
  });
});
