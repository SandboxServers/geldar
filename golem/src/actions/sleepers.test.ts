import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { parseSleepersLine, watchSleepers } from './sleepers.ts';

/** The players-sleeping line as mineflayer 4.39 gives it: the ChatMessage (top level) and its json. */
const PLAYERS = {
  json: { with: [1, 2], translate: 'sleep.players_sleeping' },
  translate: 'sleep.players_sleeping',
  with: [
    { json: { text: 1 }, text: 1 },
    { json: { text: 2 }, text: 2 },
  ],
};
/** The same line with only the raw json shape: the numbers sit in `json.with`. */
const RAW_PLAYERS = { json: { with: [1, 2], translate: 'sleep.players_sleeping' } };
const SKIPPED = {
  json: { translate: 'sleep.skipping_night' },
  translate: 'sleep.skipping_night',
};

/** A fake bot that is only its message events: `say` emits one message, `listeners` counts the subscribers. */
function fakeMessages(): {
  bot: Bot;
  say: (message: unknown, position: string) => void;
  listeners: () => number;
} {
  const emitter = new EventEmitter();
  return {
    bot: emitter as unknown as Bot,
    say: (message, position) => {
      emitter.emit('message', message, position);
    },
    listeners: () => emitter.listenerCount('message'),
  };
}

describe('parseSleepersLine', () => {
  it('reads the count from the ChatMessage shape', () => {
    expect(parseSleepersLine('game_info', PLAYERS)).toEqual({ asleep: 1, needed: 2 });
  });

  it('reads the count from the raw json shape', () => {
    expect(parseSleepersLine('game_info', RAW_PLAYERS)).toEqual({ asleep: 1, needed: 2 });
  });

  it('reads sleep.skipping_night as skipped, in either shape', () => {
    expect(parseSleepersLine('game_info', SKIPPED)).toBe('skipped');
    expect(parseSleepersLine('game_info', { translate: 'sleep.skipping_night' })).toBe('skipped');
  });

  it.each(['chat', 'system'])('ignores a sleep line on the %s position', (position) => {
    expect(parseSleepersLine(position, PLAYERS)).toBeUndefined();
    expect(parseSleepersLine(position, SKIPPED)).toBeUndefined();
  });

  it.each([
    ['a float', [1.5, 2]],
    ['a string', ['1', '2']],
    ['a negative', [-1, 2]],
    ['a number over 999', [1000, 2]],
    ['NaN', [1, Number.NaN]],
    ['a missing number', [1]],
  ])('ignores a line with %s', (_name, args) => {
    expect(
      parseSleepersLine('game_info', { translate: 'sleep.players_sleeping', with: args }),
    ).toBeUndefined();
  });

  it('keeps 0 and 999 as the edges of the range', () => {
    expect(
      parseSleepersLine('game_info', { translate: 'sleep.players_sleeping', with: [0, 999] }),
    ).toEqual({ asleep: 0, needed: 999 });
  });

  it('ignores any other translation', () => {
    expect(
      parseSleepersLine('game_info', { translate: 'sleep.not_possible', with: [1, 2] }),
    ).toBeUndefined();
    expect(parseSleepersLine('game_info', 'plain text')).toBeUndefined();
    expect(parseSleepersLine('game_info', null)).toBeUndefined();
  });
});

describe('watchSleepers', () => {
  it('ignores lines until armed, and keeps the lines after arm', () => {
    const { bot, say } = fakeMessages();
    const watch = watchSleepers(bot);
    say(PLAYERS, 'game_info');
    expect(watch.latest()).toBeUndefined();
    watch.arm();
    say(SKIPPED, 'game_info');
    expect(watch.latest()).toBe('skipped');
    watch.stop();
  });

  it('arm clears the newest line', () => {
    const { bot, say } = fakeMessages();
    const watch = watchSleepers(bot);
    watch.arm();
    say(PLAYERS, 'game_info');
    expect(watch.latest()).toEqual({ asleep: 1, needed: 2 });
    watch.arm();
    expect(watch.latest()).toBeUndefined();
    watch.stop();
  });

  it('keeps the newest line', () => {
    const { bot, say } = fakeMessages();
    const watch = watchSleepers(bot);
    watch.arm();
    say(PLAYERS, 'game_info');
    say(SKIPPED, 'game_info');
    expect(watch.latest()).toBe('skipped');
    say({ translate: 'sleep.players_sleeping', with: [0, 2] }, 'game_info');
    expect(watch.latest()).toEqual({ asleep: 0, needed: 2 });
    watch.stop();
  });

  it('keeps nothing from a chat line', () => {
    const { bot, say } = fakeMessages();
    const watch = watchSleepers(bot);
    watch.arm();
    say(PLAYERS, 'chat');
    expect(watch.latest()).toBeUndefined();
    watch.stop();
  });

  it('stop unsubscribes, and a second stop is harmless', () => {
    const { bot, say, listeners } = fakeMessages();
    const watch = watchSleepers(bot);
    expect(listeners()).toBe(1);
    watch.stop();
    watch.stop();
    expect(listeners()).toBe(0);
    say(PLAYERS, 'game_info');
    expect(watch.latest()).toBeUndefined();
  });

  it('nextLine resolves on the next line, and after its wait when no line comes', async () => {
    const { bot, say } = fakeMessages();
    const watch = watchSleepers(bot);
    watch.arm();
    const arrived = watch.nextLine(60_000);
    say(PLAYERS, 'game_info');
    await expect(arrived).resolves.toBeUndefined();
    await expect(watch.nextLine(5)).resolves.toBeUndefined();
    watch.stop();
  });
});
