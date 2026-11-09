import { EventEmitter } from 'node:events';
import type { Bot, BotOptions } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { hasUnlockedDisplay, watchRecipeBook } from './actions/craft-table.ts';
import { ConnectionManager } from './connection.ts';
import { stackVersions } from './versions.ts';

/** A bot stand-in: an emitter with a `quit` spy, so tests drive the lifecycle by hand. */
class FakeBot extends EventEmitter {
  quit = vi.fn();
  // The recipe-book watch listens on the protocol client, which the manager's fake has as an emitter.
  _client = new EventEmitter();
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
  it('hands each bot to onBot as it is created, before the session starts', async () => {
    const made: FakeBot[] = [];
    const onBot = vi.fn((_bot: Bot) => {});
    const manager = new ConnectionManager({
      host: '127.0.0.1',
      port: 25565,
      username: 'GolemSmoke',
      createBot: () => {
        const bot = new FakeBot();
        made.push(bot);
        return bot as unknown as Bot;
      },
      onBot,
      log: () => {},
    });
    manager.start().catch(() => {});
    // The hook runs synchronously inside start(), so a listener it sets sees the join's packets.
    expect(onBot).toHaveBeenCalledTimes(1);
    expect(onBot).toHaveBeenCalledWith(made[0]);
    await manager.stop();
  });

  it('closes the bot and goes fatal when onBot throws, so no socket is left open', async () => {
    const made: FakeBot[] = [];
    const manager = new ConnectionManager({
      host: '127.0.0.1',
      port: 25565,
      username: 'GolemSmoke',
      createBot: () => {
        const bot = new FakeBot();
        made.push(bot);
        return bot as unknown as Bot;
      },
      onBot: () => {
        throw new Error('hook broke');
      },
      log: () => {},
    });
    const fatals: unknown[] = [];
    manager.on('fatal', (e) => fatals.push(e));

    await expect(manager.start()).rejects.toThrow('hook broke');

    expect(made).toHaveLength(1);
    expect(made[0]?.quit).toHaveBeenCalledOnce();
    expect(manager.state).toBe('fatal');
    expect(fatals).toEqual([{ reason: 'hook broke' }]);
  });

  it('records the recipe book the join sends when onBot starts the watch', async () => {
    const made: FakeBot[] = [];
    const manager = new ConnectionManager({
      host: '127.0.0.1',
      port: 25565,
      username: 'GolemSmoke',
      createBot: () => {
        const bot = new FakeBot();
        made.push(bot);
        return bot as unknown as Bot;
      },
      onBot: watchRecipeBook,
      log: () => {},
    });
    manager.start().catch(() => {});
    const bed = { id: 900, name: 'white_bed' };
    const result = { type: 'item_stack', data: { itemId: bed.id, itemCount: 1 } };
    made[0]?._client.emit('recipe_book_add', {
      replace: false,
      entries: [
        { recipe: { displayId: 1454, display: { type: 'crafting_shaped', data: { result } } } },
      ],
    });
    expect(hasUnlockedDisplay(made[0] as unknown as Bot, bed)).toBe(true);
    await manager.stop();
  });

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
    const disconnects: unknown[] = [];
    const fatals: unknown[] = [];
    h.manager.on('disconnect', (e) => disconnects.push(e));
    h.manager.on('fatal', (e) => fatals.push(e));
    const joined = h.manager.start();
    const outcome = expect(joined).rejects.toThrow(/not whitelisted/);
    h.bots[0]?.emit('kicked', 'You are not whitelisted on this server!', true);
    h.bots[0]?.emit('end', 'disconnect.whitelist');
    await outcome;
    expect(h.manager.state).toBe('fatal');
    expect(h.createBot).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
    // The first end settles the session: the kick text is the reason, not the later `end` reason.
    const reason = 'You are not whitelisted on this server!';
    expect(disconnects).toEqual([{ reason }]);
    expect(fatals).toEqual([{ reason }]);
  });

  it('goes fatal on a kick whose reason is a component object, not a string', async () => {
    const h = harness();
    const joined = h.manager.start();
    const outcome = expect(joined).rejects.toThrow(/not_whitelisted/);
    h.bots[0]?.emit('kicked', { translate: 'multiplayer.disconnect.not_whitelisted' }, true);
    await outcome;
    expect(h.manager.state).toBe('fatal');
    expect(h.createBot).toHaveBeenCalledTimes(1);
  });

  it('goes fatal on a not-admitted kick with a message that names GELDAR_NATS_URL', async () => {
    const h = harness();
    const joined = h.manager.start();
    const outcome = expect(joined).rejects.toThrow(/GELDAR_NATS_URL/);
    h.bots[0]?.emit('kicked', 'This connection is not admitted.', true);
    await outcome;
    expect(h.manager.state).toBe('fatal');
    expect(h.createBot).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('goes fatal on a not-admitted kick sent as a text component', async () => {
    const h = harness();
    const joined = h.manager.start();
    const outcome = expect(joined).rejects.toThrow(/GELDAR_NATS_URL/);
    h.bots[0]?.emit('kicked', { text: 'This connection is not admitted.' }, true);
    await outcome;
    expect(h.manager.state).toBe('fatal');
  });

  it('a not-admitted text in an end reason, not a kick, still retries', async () => {
    const h = harness();
    h.manager.start().catch(() => {});
    h.bots[0]?.emit('end', 'This connection is not admitted.');
    await vi.waitFor(() => expect(h.sleeps).toEqual([1000]));
    expect(h.manager.state).not.toBe('fatal');
    await h.manager.stop();
  });
  it('a respawn in the same session neither restarts the stability clock nor spawns again', async () => {
    const h = harness();
    const spawns: unknown[] = [];
    h.manager.on('spawn', (bot) => spawns.push(bot));
    const joined = h.manager.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await h.waitForBots(2);
    h.bots[1]?.emit('spawn');
    h.clock.t = 9000;
    h.bots[1]?.emit('spawn');
    h.clock.t = 10_000;
    h.bots[1]?.emit('end', 'closed');
    await h.waitForBots(3);
    // The session was 10 s old at its end, measured from the first spawn: a stable session.
    expect(h.sleeps).toEqual([1000, 1000]);
    expect(h.manager.attempt).toBe(1);
    expect(spawns).toEqual([h.bots[1]]);
    await h.manager.stop();
  });

  it('creates no new bot when stopped while a backoff sleep is pending', async () => {
    const h = harness();
    let wake: () => void = () => {};
    const deferred = new ConnectionManager({
      host: '127.0.0.1',
      port: 25565,
      username: 'GolemSmoke',
      createBot: h.createBot,
      sleep: () =>
        new Promise<void>((resolve) => {
          wake = resolve;
        }),
      now: () => h.clock.t,
      rng: () => 0.5,
      log: () => {},
    });
    const joined = deferred.start();
    joined.catch(() => {});
    h.bots[0]?.emit('end', 'closed');
    await vi.waitFor(() => expect(deferred.state).toBe('backoff'));
    await deferred.stop();
    expect(deferred.state).toBe('stopped');
    // The sleep finishes only now, after stop(): the manager must not join again.
    wake();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.createBot).toHaveBeenCalledTimes(1);
    expect(deferred.state).toBe('stopped');
    expect(h.bots[0]?.quit).toHaveBeenCalled();
  });

  it('stop() cancels the real backoff timer, leaving none behind', async () => {
    vi.useFakeTimers();
    try {
      const bots: FakeBot[] = [];
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
        rng: () => 0.5,
        log: () => {},
      });
      const joined = manager.start();
      joined.catch(() => {});
      bots[0]?.emit('end', 'closed');
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.state).toBe('backoff');
      expect(vi.getTimerCount()).toBe(1);
      await manager.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(createBot).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
