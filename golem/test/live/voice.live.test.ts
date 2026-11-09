import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import { loadStackConfig } from '../../src/config.ts';
import { ConnectionManager } from '../../src/connection.ts';
import { registryFromConfig } from '../../src/registry.ts';
import { BotEars } from '../../src/voice/ears.ts';
import { SpeechEvents } from '../../src/voice/speech-event.ts';
import { BotVoice } from '../../src/voice/voice.ts';
import { withLiveBot } from './fixture.ts';

/** The arena slot for this file (P0-24: slot 7) and the two bots that play it. */
const SLOT = 7;
const BODY = 'GolemEars';
const SPEAKER = 'GolemSpeaker';

/** Polls of one tick each before a line or a clock gives up. */
const POLL_LIMIT = 200;

describe('voice: ears, voice and wait against a real server', () => {
  it('hears a line from a second bot, hears itself not, speaks, and waits', async () => {
    await withLiveBot({ name: BODY, slot: SLOT }, async ({ bot, ctl, manager: _own }) => {
      const cfg = loadStackConfig();
      const published: WorldEvent[] = [];
      const logs: string[] = [];
      const addressed: string[] = [];
      const events = new SpeechEvents({
        publish: (e) => published.push(e),
        shard: 'phase0',
        worldTick: () => bot.time.age,
        log: (l) => logs.push(l),
      });
      const ears = new BotEars({
        username: BODY,
        executor: {
          notifyAddressed: async (from) => {
            addressed.push(from);
            return true;
          },
        },
        events,
        log: (l) => logs.push(l),
      });
      const detach = ears.attach(bot);
      const voice = new BotVoice({
        username: BODY,
        send: (text) => bot.chat(text),
        connected: () => bot.entity !== undefined,
        events,
        rateLimitSeconds: 3,
      });

      // Diagnostics first: every failure message carries the raw shape, the heard lines and the events.
      const seen = () =>
        `heard ${JSON.stringify(ears.heard())}; addressed ${JSON.stringify(addressed)}; ` +
        `events ${JSON.stringify(published.map((e) => e.payload))}; logs ${JSON.stringify(logs)}`;

      await ctl.whitelistAdd(SPEAKER);
      const speakerManager = new ConnectionManager({
        host: cfg.mcHost,
        port: cfg.mcPort,
        username: SPEAKER,
        registry: registryFromConfig(cfg),
      });
      try {
        const speaker = await speakerManager.start();
        await speaker.waitForTicks(10);

        speaker.chat(`${BODY}, hello`);
        for (let i = 0; i < POLL_LIMIT && ears.heard().length === 0; i++) await bot.waitForTicks(1);
        const line = ears.heard().find((l) => l.from === SPEAKER);
        expect(line?.text, seen()).toBe(`${BODY}, hello`);
        expect(addressed, seen()).toEqual([SPEAKER]);
        expect(
          published.some((e) => (e.payload as { own?: boolean }).own === false),
          seen(),
        ).toBe(true);

        const heardBySpeaker: string[] = [];
        speaker.on('chat', (username, message) => {
          heardBySpeaker.push(`${username}: ${message}`);
        });
        const said = await voice.say('hello back');
        expect(said, seen()).toEqual({ status: 'said', text: 'hello back' });
        for (let i = 0; i < POLL_LIMIT && heardBySpeaker.length === 0; i++) {
          await speaker.waitForTicks(1);
        }
        expect(heardBySpeaker, seen()).toContain(`${BODY}: hello back`);
        expect(
          ears.heard().some((l) => l.from === BODY),
          seen(),
        ).toBe(false);

        const refused = await voice.say('second line right away');
        expect(refused, seen()).toEqual({ status: 'refused', reason: 'rate_limited' });

        const started = Date.now();
        const run = await runAction(createRegistry(), bot, { do: 'wait', seconds: 3 });
        const took = Date.now() - started;
        expect(run.state, seen()).toBe('completed');
        expect(took, `wait 3 took ${took} ms`).toBeGreaterThanOrEqual(2_800);
        expect(took, `wait 3 took ${took} ms`).toBeLessThan(5_000);
      } finally {
        detach();
        await speakerManager.stop().catch(() => undefined);
        await ctl.whitelistRemove(SPEAKER).catch(() => undefined);
      }
    });
  });
});
