/**
 * Live cases (c) restart and (d) sleep of P0-33, on `qwen3:8b` (life `ag_adam_02`). Written, not
 * run; `GELDAR_IT=1 GELDAR_OLLAMA=1`. What the model chooses is not asserted: only that the intent
 * survives a Body crash with the next generation, and that one night's sleep gives exactly one
 * reflection row and its memories.
 */
import { describe, expect, it } from 'vitest';
import { withAdamCase } from './adam-case.ts';
import { ADAM_LIFE_ID, memoriesFrom, mindLiveEnabled } from './adam-stack.ts';

const SLOT = 10;
const FIRST_INTENT_MS = 150_000;
const RESUME_MS = 90_000;
const SLEEP_MS = 360_000;
const SETTLE_MS = 20_000;

describe.skipIf(!mindLiveEnabled)('Adam across a Body crash and a night', () => {
  it('resumes the intent from the checkpoint after the Body is killed, and the next plan carries the new generation', async () => {
    await withAdamCase({ slot: SLOT }, async (ac) => {
      const running = await ac.waitFor('an intent running', FIRST_INTENT_MS, async () =>
        (await ac.intents()).find((i) => i.state === 'running'),
      );
      const generation = running.body_generation;
      const killedAt = new Date().toISOString();

      await ac.stack.restartBody();

      // The old intent continues under the new generation (or has completed by now).
      const resumed = await ac.waitFor(
        `intent ${running.intent_id} continuing under a generation above ${generation}`,
        RESUME_MS,
        async () =>
          (await ac.intents()).find(
            (i) =>
              i.intent_id === running.intent_id &&
              i.body_generation > generation &&
              (i.state === 'running' || i.state === 'completed'),
          ),
      );
      expect(resumed.body_generation, await ac.state()).toBeGreaterThan(generation);

      // The Mind's next thought is made from a snapshot of the new Body.
      const next = await ac.waitFor(
        'a thought made after the restart on the new generation',
        RESUME_MS,
        async () =>
          (await ac.thoughts()).find(
            (t) => t.valid && t.at >= killedAt && (t.body_generation ?? 0) > generation,
          ),
      );
      expect(next.body_generation, await ac.state()).toBeGreaterThan(generation);
      // If that thought became an intent, the Body recorded it under the same generation.
      const made = (await ac.intents()).filter((i) => i.thought_id === next.thought_id);
      for (const intent of made) {
        expect(intent.body_generation, await ac.state()).toBe(next.body_generation);
      }
    });
  }, 900_000);

  it('sleeps at night and writes exactly one reflection row and its memories', async () => {
    await withAdamCase({ slot: SLOT, time: 'night' }, async (ac) => {
      const { x, y, z } = ac.live.arena.center;
      // A bed next to Adam; the sleep action finds it by itself.
      await ac.live.ctl.setblock(x + 3, y + 1, z + 1, 'white_bed');
      await ac.chatter.say('Adam, it is night and a bed stands next to you. Please go to sleep.');

      const reflection = await ac.waitFor('a reflection row after Adam slept', SLEEP_MS, async () =>
        (await ac.thoughts()).find((t) => t.wake_reason === 'reflection'),
      );
      // Give a second reflection, a duplicate or a late row time to show up before counting.
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      const rows = (await ac.thoughts()).filter((t) => t.wake_reason === 'reflection');
      expect(rows.length, `expected exactly one reflection row\n${await ac.state()}`).toBe(1);
      expect(rows[0]?.thought_id, await ac.state()).toBe(reflection.thought_id);
      expect(rows[0]?.valid, `the reflection was not valid\n${await ac.state()}`).toBe(true);

      const memories = await memoriesFrom(ac.db, [reflection.thought_id]);
      expect(
        memories.length,
        `no memories from the reflection (${ADAM_LIFE_ID})\n${await ac.state()}`,
      ).toBeGreaterThan(0);
    });
  }, 900_000);
});
