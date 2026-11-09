import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { lifeIdFor } from '../../src/registry.ts';
import { CHATTER_LIFE_ID, ChatterBot } from './chatter-bot.ts';

/** A bot that records what it chats and lets a test make it hear a line. */
function fakeBot(): { bot: Bot; chatted: string[]; hear(from: string, text: string): void } {
  const chatted: string[] = [];
  const emitter = new EventEmitter();
  const bot = Object.assign(emitter, {
    _client: new EventEmitter(),
    entity: {},
    players: {},
    chat: (text: string) => {
      chatted.push(text);
    },
  }) as unknown as Bot;
  return { bot, chatted, hear: (from, text) => emitter.emit('chat', from, text) };
}

/** A clock the test moves by hand, and a sleep that moves it. */
function manualTime() {
  let ms = 1_000_000;
  return {
    now: () => ms,
    sleep: async (wait: number) => {
      ms += wait;
    },
  };
}

describe('the scripted chatter bot', () => {
  it('has a life id the registry keeps unchanged', () => {
    expect(CHATTER_LIFE_ID).toBe('ag_chatter_01');
    expect(lifeIdFor(CHATTER_LIFE_ID)).toBe(CHATTER_LIFE_ID);
  });

  it('says a line with the voice limits and records it as a test life', async () => {
    const { bot, chatted } = fakeBot();
    const time = manualTime();
    const chatter = new ChatterBot(bot, { rateLimitSeconds: 3, maxChars: 20, ...time });
    const said = await chatter.say('Adam,\n   hello there, how are you today');
    expect(said).toEqual({ status: 'said', text: 'Adam, hello there, h' });
    expect(chatted).toEqual(['Adam, hello there, h']);
    expect(await chatter.say('/op me')).toEqual({ status: 'refused', reason: 'command' });
    expect(await chatter.say('again at once')).toEqual({
      status: 'refused',
      reason: 'rate_limited',
    });
    expect(chatted).toHaveLength(1);
    expect(chatter.records.map((r) => r.kind)).toEqual(['said', 'refused', 'refused']);
    expect(chatter.records.every((r) => r.test_life && r.life_id === CHATTER_LIFE_ID)).toBe(true);
  });

  it('sayAll waits out the rate limit and says every line', async () => {
    const { bot, chatted } = fakeBot();
    const time = manualTime();
    const chatter = new ChatterBot(bot, { rateLimitSeconds: 3, maxChars: 256, ...time });
    const outcomes = await chatter.sayAll(['one', 'two', 'three']);
    expect(outcomes.map((o) => o.status)).toEqual(['said', 'said', 'said']);
    expect(chatted).toEqual(['one', 'two', 'three']);
    // The pacing came from the planned waits, not from a refusal and a retry.
    expect(chatter.records.filter((r) => r.kind === 'refused')).toEqual([]);
  });

  it('records what it hears, never its own line, and waits for a match', async () => {
    const { bot, hear } = fakeBot();
    const time = manualTime();
    const chatter = new ChatterBot(bot, { rateLimitSeconds: 3, maxChars: 256, ...time });
    hear('ag_adam_02', 'Hello, Steve');
    hear(CHATTER_LIFE_ID, 'my own line');
    expect(chatter.heard().map((r) => `${r.from}: ${r.text}`)).toEqual([
      'ag_adam_02: Hello, Steve',
    ]);
    const found = await chatter.waitForHeard('ag_adam_02', (t) => t.includes('Hello'), 1_000);
    expect(found?.text).toBe('Hello, Steve');
    const missed = await chatter.waitForHeard('ag_adam_02', (t) => t.includes('wood'), 1_000);
    expect(missed).toBeNull();
    expect(chatter.describe()).toContain('ag_adam_02: Hello, Steve');
  });

  it('stops listening on stop', () => {
    const { bot, hear } = fakeBot();
    const chatter = new ChatterBot(bot, { rateLimitSeconds: 3, maxChars: 256 });
    chatter.stop();
    hear('ag_adam_02', 'anyone there');
    expect(chatter.heard()).toEqual([]);
  });
});
