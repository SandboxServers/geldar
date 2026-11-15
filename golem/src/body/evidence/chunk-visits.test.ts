import { EventEmitter } from 'node:events';
import type { WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { eventIdFor } from '../derived-id.ts';
import { type ChunkWatchOptions, watchChunkVisits } from './chunk-visits.ts';

const LIFE = 'ag_kestrel_01';

interface FakeBot extends EventEmitter {
  entity: { position: Vec3 | undefined };
  game: { dimension: string };
}

function fakeBot(dimension = 'overworld'): FakeBot {
  return Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0, 64, 0) },
    game: { dimension },
  }) as FakeBot;
}

/** Puts the bot at (x, z) in its current dimension and fires the move event. */
function walkTo(bot: FakeBot, x: number, z: number): void {
  bot.entity.position = new Vec3(x, 64, z);
  bot.emit('move');
}

function watch(bot: FakeBot, overrides: Partial<ChunkWatchOptions> = {}) {
  const published: WorldEvent[] = [];
  const log = vi.fn();
  const stop = watchChunkVisits({
    bot: bot as unknown as Bot,
    shard: 'phase0',
    lifeId: LIFE,
    tick: () => 30_000,
    publish: (event) => published.push(event),
    now: () => new Date('2026-11-14T10:00:00.000Z'),
    log,
    ...overrides,
  });
  return { published, log, stop };
}

function cellsOf(published: WorldEvent[]): string[] {
  return published.map((e) => `${String(e.payload.dimension)}:${e.payload.cx}:${e.payload.cz}`);
}

describe('watchChunkVisits: first visits', () => {
  it('emits one chunk_visited event on the first entry', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, 5, 5);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'chunk_visited',
      shard: 'phase0',
      agent_id: LIFE,
      world_tick: 30_000,
      world_day: 1,
      at: '2026-11-14T10:00:00.000Z',
      payload: { life_id: LIFE, dimension: 'overworld', cx: 0, cz: 0, tick: 30_000 },
    });
    stop();
  });

  it('emits nothing when the bot moves within the same chunk again', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, 1, 1);
    walkTo(bot, 15, 15);
    walkTo(bot, 0, 0);
    expect(cellsOf(published)).toEqual(['overworld:0:0']);
    stop();
  });

  it('emits a new event for a new chunk', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, 1, 1);
    walkTo(bot, 16, 1);
    walkTo(bot, 16, 16);
    expect(cellsOf(published)).toEqual(['overworld:0:0', 'overworld:1:0', 'overworld:1:1']);
    stop();
  });

  it('counts a dimension change as a new chunk even at the same index', () => {
    const bot = fakeBot('overworld');
    const { published, stop } = watch(bot);
    walkTo(bot, 1, 1);
    bot.game.dimension = 'the_nether';
    walkTo(bot, 1, 1);
    expect(cellsOf(published)).toEqual(['overworld:0:0', 'the_nether:0:0']);
    expect(published[0]?.source_event_id).not.toBe(published[1]?.source_event_id);
    stop();
  });

  it('floors negative coordinates: -1 is chunk -1, -16 is chunk -1, -17 is chunk -2', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, -1, -1);
    expect(cellsOf(published)).toEqual(['overworld:-1:-1']);
    walkTo(bot, -16, -16);
    expect(cellsOf(published)).toEqual(['overworld:-1:-1']);
    walkTo(bot, -17, 0);
    expect(cellsOf(published)).toEqual(['overworld:-1:-1', 'overworld:-2:0']);
    stop();
  });
});

describe('watchChunkVisits: identity and restarts', () => {
  it('derives source_event_id from the life, dimension and chunk index', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, 20, -3);
    expect(published[0]?.source_event_id).toBe(eventIdFor(`chunk_visited:${LIFE}:overworld:1:-1`));
    stop();
  });

  it('a restart with a fresh set re-emits the same source_event_id for a known chunk', () => {
    const first = fakeBot();
    const run1 = watch(first);
    walkTo(first, 4, 4);
    const id1 = run1.published[0]?.source_event_id;
    run1.stop();

    const second = fakeBot();
    const run2 = watch(second);
    walkTo(second, 4, 4);
    expect(run2.published).toHaveLength(1);
    expect(run2.published[0]?.source_event_id).toBe(id1);
    run2.stop();
  });

  it('clears the known set past maxKnown, so a revisit re-emits the identical event', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot, { maxKnown: 2 });
    walkTo(bot, 0, 0);
    walkTo(bot, 16, 0);
    walkTo(bot, 32, 0);
    walkTo(bot, 0, 0);
    expect(cellsOf(published)).toEqual([
      'overworld:0:0',
      'overworld:1:0',
      'overworld:2:0',
      'overworld:0:0',
    ]);
    expect(published[3]?.source_event_id).toBe(published[0]?.source_event_id);
    stop();
  });
});

describe('watchChunkVisits: stop and error paths', () => {
  it('stop removes the move listener and later moves emit nothing', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    walkTo(bot, 0, 0);
    stop();
    expect(bot.listenerCount('move')).toBe(0);
    walkTo(bot, 64, 64);
    expect(published).toHaveLength(1);
  });

  it('emits nothing while the position is unknown', () => {
    const bot = fakeBot();
    const { published, stop } = watch(bot);
    bot.entity.position = undefined;
    bot.emit('move');
    expect(published).toHaveLength(0);
    stop();
  });

  it('logs and emits nothing when the envelope is invalid (no dimension)', () => {
    const bot = fakeBot('');
    const { published, log, stop } = watch(bot);
    walkTo(bot, 0, 0);
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs and does not record the chunk when publish throws, so a re-entry retries it', () => {
    const bot = fakeBot();
    let fail = true;
    const { published, log, stop } = watch(bot, {
      publish: (event) => {
        if (fail) throw new Error('nats down');
        published.push(event);
      },
    });
    expect(() => walkTo(bot, 0, 0)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not published'));
    fail = false;
    walkTo(bot, 1, 1);
    expect(published).toHaveLength(1);
    stop();
  });

  it('logs and does not publish an event the envelope schema rejects (empty shard)', () => {
    const bot = fakeBot();
    const { published, log, stop } = watch(bot, { shard: '' });
    walkTo(bot, 0, 0);
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not recorded'));
    stop();
  });

  it('emits nothing, logs nothing and does not throw for a non-finite position', () => {
    const bot = fakeBot();
    const { published, log, stop } = watch(bot);
    expect(() => {
      walkTo(bot, Number.NaN, 0);
      walkTo(bot, Number.POSITIVE_INFINITY, 0);
      walkTo(bot, 0, Number.NEGATIVE_INFINITY);
    }).not.toThrow();
    expect(published).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
    stop();
  });
});

describe('watchChunkVisits: bounded failures and invalid input', () => {
  it('gives up on a chunk after 3 failed publishes, however many moves follow', () => {
    const bot = fakeBot();
    const publish = vi.fn(() => {
      throw new Error('nats down');
    });
    const { log, stop } = watch(bot, { publish });
    for (let i = 0; i < 100; i++) walkTo(bot, i % 15, 0);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('dropped'));
    stop();
  });

  it('publishes on the last allowed attempt, then never again for that chunk', () => {
    const bot = fakeBot();
    let failures = 2;
    let attempts = 0;
    const { published, log, stop } = watch(bot, {
      publish: (event) => {
        attempts++;
        if (failures > 0) {
          failures--;
          throw new Error('nats down');
        }
        published.push(event);
      },
    });
    walkTo(bot, 0, 0);
    walkTo(bot, 0, 0);
    walkTo(bot, 0, 0);
    expect(attempts).toBe(3);
    expect(published).toHaveLength(1);
    for (let i = 0; i < 10; i++) walkTo(bot, 1, 1);
    expect(attempts).toBe(3);
    expect(log).toHaveBeenCalledTimes(2);
    stop();
  });

  it('handles an async publisher that rejects: retries, then gives up after 3 rejections', async () => {
    const bot = fakeBot();
    const publish = vi.fn(() => Promise.reject(new Error('nats down')));
    const { log, stop } = watch(bot, { publish });
    for (let i = 0; i < 10; i++) {
      walkTo(bot, 0, 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(publish).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
    stop();
  });

  it('logs an invalid dimension once across several moves in the same chunk', () => {
    const bot = fakeBot('');
    const { published, log, stop } = watch(bot);
    for (let i = 0; i < 5; i++) walkTo(bot, i, 0);
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs an out-of-range chunk index once and emits nothing', () => {
    const bot = fakeBot();
    const { published, log, stop } = watch(bot);
    for (let i = 0; i < 4; i++) walkTo(bot, 16 * 2_000_001, 0);
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs an invalid tick once and emits nothing', () => {
    const bot = fakeBot();
    const { published, log, stop } = watch(bot, { tick: () => Number.NaN });
    for (let i = 0; i < 4; i++) walkTo(bot, 0, 0);
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not throw into the move event when tick() throws, and logs once per chunk', () => {
    const bot = fakeBot();
    const { published, log, stop } = watch(bot, {
      tick: () => {
        throw new Error('no clock');
      },
    });
    expect(() => {
      walkTo(bot, 0, 0);
      walkTo(bot, 1, 1);
      walkTo(bot, 16, 0);
      walkTo(bot, 16, 0);
    }).not.toThrow();
    expect(published).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not throw when the logger itself throws', () => {
    const bot = fakeBot('');
    const { stop } = watch(bot, {
      log: () => {
        throw new Error('log sink down');
      },
    });
    expect(() => walkTo(bot, 0, 0)).not.toThrow();
    stop();
  });
});
