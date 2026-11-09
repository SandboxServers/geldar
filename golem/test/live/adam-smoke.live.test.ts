/**
 * Live case (a) of P0-33: Adam on `qwen3:8b` (life `ag_adam_02`). Written, not run; it needs the
 * shard, Postgres, NATS and Ollama, so it runs only with `GELDAR_IT=1 GELDAR_OLLAMA=1`.
 * What the model chooses is not asserted: only that it thought, that the plan was accepted and an
 * intent exists, and that the latency was recorded.
 */
import { describe, expect, it } from 'vitest';
import { withAdamCase } from './adam-case.ts';
import { mindLiveEnabled } from './adam-stack.ts';

const SLOT = 10;
const BUDGET_MS = 90_000;
const ACCEPTED = ['accepted', 'running', 'completed'];

describe.skipIf(!mindLiveEnabled)('Adam smoke: the Mind thinks and the Body acts', () => {
  it('records a valid thought, an accepted plan, an accepted intent and a latency within 90 s', async () => {
    await withAdamCase({ slot: SLOT }, async (ac) => {
      const t0 = Date.now();
      const left = () => Math.max(1, BUDGET_MS - (Date.now() - t0));

      const valid = await ac.waitFor('a valid thought', left(), async () =>
        (await ac.thoughts()).find((t) => t.valid && t.wake_reason !== 'reflection'),
      );
      expect(valid.valid, await ac.state()).toBe(true);

      const plan = await ac.waitFor(
        'an accepted plan (an intent made from a valid thought)',
        left(),
        async () => {
          const good = new Set(
            (await ac.thoughts()).filter((t) => t.valid).map((t) => t.thought_id),
          );
          return (await ac.intents()).find((i) => i.thought_id !== null && good.has(i.thought_id));
        },
      );
      expect(plan.thought_id, await ac.state()).not.toBeNull();

      const intent = await ac.waitFor('an accepted intent', left(), async () =>
        (await ac.intents()).find((i) => ACCEPTED.includes(i.state)),
      );
      expect(ACCEPTED, await ac.state()).toContain(intent.state);

      const timed = await ac.waitFor('a thoughts row with a latency', left(), async () =>
        (await ac.thoughts()).find((t) => t.latency_ms !== null && t.latency_ms > 0),
      );
      expect(timed.latency_ms, await ac.state()).toBeGreaterThan(0);
      expect(Date.now() - t0, await ac.state()).toBeLessThanOrEqual(BUDGET_MS + 2_000);
    });
  }, 300_000);
});
