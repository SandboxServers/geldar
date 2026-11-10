/**
 * Live cases (c) restart and (d) sleep of P0-33, on `qwen3:8b` (life `ag_adam_02`). Written, not
 * run; `GELDAR_IT=1 GELDAR_OLLAMA=1`. What the model chooses is not asserted: only that the intent
 * survives a Body crash with the next generation, and that one night's sleep gives exactly one
 * reflection row and its memories.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planEvidence, withAdamCase } from './adam-case.ts';
import { currentGeneration, openSeedDeps, seedRunningIntent, travelIntent } from './adam-seed.ts';
import { ADAM_LIFE_ID, memoriesFrom, mindLiveEnabled } from './adam-stack.ts';

const SLOT = 10;
/** The shard `adam-stack` starts (its default), where the seeded intent's rows are published. */
const SHARD = 'phase0';
/** A world tick far past any tick the shard reaches in a case, so the seeded intent never expires. */
const FAR_TICK = 2_000_000_000;
/** Polls faster than the default second, to catch an intent before it completes. */
const FAST_POLL_MS = 500;
const FIRST_INTENT_MS = 60_000;
const RESUME_MS = 90_000;
const SLEEP_MS = 360_000;
const SETTLE_MS = 20_000;

describe.skipIf(!mindLiveEnabled)('Adam across a Body crash and a night', () => {
  it('after the Body is killed, the next plan carries a generation above the one it was planned under', async () => {
    await withAdamCase({ slot: SLOT, kind: 'restart' }, async (ac) => {
      // The day and the empty inventory leave Adam nothing to do on his own, so the chatter gives him
      // a walk to make: the travel goal the first plan carries.
      ac.chatter.speak();
      await ac.chatter.say('Adam, walk over to the far wall of the arena and look around.');
      await ac.waitFor(
        'an accepted plan (an intent made from a valid thought, or an action of it completed)',
        FIRST_INTENT_MS,
        async () => planEvidence(await ac.thoughts(), await ac.intents(), await ac.actions()),
        FAST_POLL_MS,
      );
      // The generation the plan was made under: the highest one a thought of this case recorded.
      const generation = Math.max(0, ...(await ac.thoughts()).map((t) => t.body_generation ?? 0));
      expect(generation, await ac.state()).toBeGreaterThan(0);
      const killedAt = new Date().toISOString();

      await ac.stack.restartBody();

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

  it('resumes the intent from the checkpoint after the Body is killed, and the next plan carries the new generation', async () => {
    await withAdamCase({ slot: SLOT, kind: 'restart' }, async (ac) => {
      // No intent of Adam's own may be running when the seed goes in, so the seeded one is the only one.
      await ac.waitFor('no running intent before the seed', FIRST_INTENT_MS, async () =>
        (await ac.intents()).every((i) => i.state !== 'running' && i.state !== 'accepted'),
      );
      const deps = await openSeedDeps();
      try {
        const generation = await currentGeneration(deps.generations, ADAM_LIFE_ID);
        const { x, y, z } = ac.live.arena.center;
        const target = { x: x + 4, y, z };
        // A fresh id per run: an intent id must match `in_` and 26 Crockford base32 characters.
        const intentId = `in_${randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`;
        // The world tick is not read here: tick 0 labels the rows, and the far expiry keeps the intent live.
        await seedRunningIntent(deps, {
          lifeId: ADAM_LIFE_ID,
          shard: SHARD,
          bodyGeneration: generation,
          intentId,
          tick: 0,
          expiresTick: FAR_TICK,
          intent: travelIntent(target),
          checkpoint: { target, legs: 0 },
        });
        const planned = await ac.waitFor(
          `the seeded intent ${intentId} in the intents table`,
          FIRST_INTENT_MS,
          async () => (await ac.intents()).find((i) => i.intent_id === intentId),
          FAST_POLL_MS,
        );
        const killedAt = new Date().toISOString();

        await ac.stack.restartBody();

        // The intent resumes under the new generation, or it had completed (before or after the kill).
        const resumed = await ac.waitFor(
          `intent ${planned.intent_id} resumed or completed under a generation above ${generation}`,
          RESUME_MS,
          async () =>
            (await ac.intents()).find(
              (i) =>
                i.intent_id === planned.intent_id &&
                (i.state === 'completed' || i.body_generation > generation),
            ),
        );
        expect(
          resumed.state === 'completed' || resumed.body_generation > generation,
          await ac.state(),
        ).toBe(true);

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
      } finally {
        await deps.close();
      }
    });
  }, 900_000);

  it('sleeps at night and writes exactly one reflection row and its memories', async () => {
    await withAdamCase({ slot: SLOT, kind: 'sleep' }, async (ac) => {
      const { x, y, z } = ac.live.arena.center;
      // A whole bed next to Adam, both halves (a lone white_bed is a half bed, which sleep refuses).
      // The block states need `command`: `setblock` takes plain ids only.
      await ac.live.ctl.command(
        `setblock ${x + 2} ${y + 1} ${z + 1} white_bed[part=foot,facing=east]`,
      );
      await ac.live.ctl.command(
        `setblock ${x + 3} ${y + 1} ${z + 1} white_bed[part=head,facing=east]`,
      );
      ac.chatter.speak();
      await ac.chatter.say(
        'Adam, it is night and a bed is right next to you. Go to bed and sleep.',
      );

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
