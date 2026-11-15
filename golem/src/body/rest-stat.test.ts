import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchRestStat } from './rest-stat.ts';

/** A fake bot with a protocol client that records its writes, as the server-facing side of mineflayer does. */
function fakeRestBot(version: string | undefined = '26.1.2', withClient = true) {
  const bot = new EventEmitter() as EventEmitter & { version?: string; _client?: unknown };
  bot.version = version;
  const client = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn> };
  client.write = vi.fn();
  if (withClient) bot._client = client;
  return { bot: bot as unknown as Bot, emitter: bot, client };
}

/** A sink that records the lines it is given. */
function recordingSink() {
  return { log: vi.fn((_line: string) => undefined), now: () => 0 };
}

/** The clientbound statistics packet with the given entries. */
function statistics(entries: { categoryId: number; statisticId: number; value: number }[]) {
  return { entries };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the time since rest', () => {
  it('requests the statistics with actionId 1 on spawn, then every five minutes', () => {
    const { bot, emitter, client } = fakeRestBot();
    watchRestStat(bot, { sink: recordingSink() });
    expect(client.write).not.toHaveBeenCalled();
    emitter.emit('spawn');
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenLastCalledWith('client_command', { actionId: 1 });
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(client.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(client.write).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5 * 60_000);
    expect(client.write).toHaveBeenCalledTimes(3);
    expect(client.write).toHaveBeenLastCalledWith('client_command', { actionId: 1 });
  });

  it('requests again 2 s after a successful sleep', () => {
    const { bot, emitter, client } = fakeRestBot();
    watchRestStat(bot, { sink: recordingSink() });
    emitter.emit('spawn');
    client.write.mockClear();
    emitter.emit('sleep');
    vi.advanceTimersByTime(1_999);
    expect(client.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenLastCalledWith('client_command', { actionId: 1 });
  });

  it('logs one rest_stat line for a reply with the pinned ids', () => {
    const { bot, emitter, client } = fakeRestBot();
    const sink = recordingSink();
    watchRestStat(bot, { sink });
    emitter.emit('spawn');
    client.emit(
      'statistics',
      statistics([
        { categoryId: 8, statisticId: 3, value: 99 },
        { categoryId: 8, statisticId: 4, value: 2_500 },
      ]),
    );
    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(sink.log).toHaveBeenCalledWith(
      '{"event":"rest_stat","ticks_since_rest":2500,"minutes":2}',
    );
  });

  it('logs nothing for a reply without the time-since-rest entry', () => {
    const { bot, emitter, client } = fakeRestBot();
    const sink = recordingSink();
    watchRestStat(bot, { sink });
    emitter.emit('spawn');
    client.emit('statistics', statistics([{ categoryId: 8, statisticId: 3, value: 99 }]));
    client.emit('statistics', statistics([{ categoryId: 7, statisticId: 4, value: 99 }]));
    client.emit('statistics', { entries: [] });
    client.emit('statistics', {});
    expect(sink.log).not.toHaveBeenCalled();
  });

  it('does nothing on version 1.21: no listener, no request, no line', () => {
    const { bot, emitter, client } = fakeRestBot('1.21');
    const sink = recordingSink();
    watchRestStat(bot, { sink });
    emitter.emit('spawn');
    vi.advanceTimersByTime(10 * 60_000);
    client.emit('statistics', statistics([{ categoryId: 8, statisticId: 4, value: 5 }]));
    expect(client.write).not.toHaveBeenCalled();
    expect(client.listenerCount('statistics')).toBe(0);
    expect(sink.log).not.toHaveBeenCalled();
  });

  it('does nothing when the bot has no protocol client, and does not throw', () => {
    const { bot, emitter } = fakeRestBot('26.1.2', false);
    expect(() => watchRestStat(bot, { sink: recordingSink() })).not.toThrow();
    expect(() => emitter.emit('spawn')).not.toThrow();
    expect(() => vi.advanceTimersByTime(10 * 60_000)).not.toThrow();
  });

  it('stops its timers and listeners when the bot ends', () => {
    const { bot, emitter, client } = fakeRestBot();
    const sink = recordingSink();
    watchRestStat(bot, { sink });
    emitter.emit('spawn');
    emitter.emit('end');
    client.write.mockClear();
    vi.advanceTimersByTime(10 * 60_000);
    emitter.emit('sleep');
    vi.advanceTimersByTime(10_000);
    expect(client.write).not.toHaveBeenCalled();
    expect(client.listenerCount('statistics')).toBe(0);
    client.emit('statistics', statistics([{ categoryId: 8, statisticId: 4, value: 5 }]));
    expect(sink.log).not.toHaveBeenCalled();
  });
});
