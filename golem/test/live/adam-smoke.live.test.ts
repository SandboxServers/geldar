/**
 * Live case (a) of P0-33: Adam on `qwen3:8b` (life `ag_adam_02`). Written, not run; it needs the
 * shard, Postgres, NATS and Ollama, so it runs only with `GELDAR_IT=1 GELDAR_OLLAMA=1`.
 * What the model chooses is not asserted: only that it thought, that the plan was accepted (an
 * intent made from the thought, or an action of that intent completed) and that the latency was
 * recorded. The case starts at day with an empty inventory (see `caseSetup`).
 */
import { describe, expect, it } from 'vitest';
import { planEvidence, withAdamCase } from './adam-case.ts';
import { mindLiveEnabled } from './adam-stack.ts';

const SLOT = 10;
const BUDGET_MS = 90_000;

describe.skipIf(!mindLiveEnabled)('Adam smoke: the Mind thinks and the Body acts', () => {
  it('records a valid thought, an accepted plan (an intent or a completed action), and a latency within 90 s', async () => {
    await withAdamCase({ slot: SLOT, kind: 'smoke' }, async (ac) => {
      const t0 = Date.now();
      const left = () => Math.max(1, BUDGET_MS - (Date.now() - t0));

      const valid = await ac.waitFor('a valid thought', left(), async () =>
        (await ac.thoughts()).find((t) => t.valid && t.wake_reason !== 'reflection'),
      );
      expect(valid.valid, await ac.state()).toBe(true);

      const plan = await ac.waitFor(
        'an accepted plan (an intent made from a valid thought, or an action of it completed)',
        left(),
        async () => planEvidence(await ac.thoughts(), await ac.intents(), await ac.actions()),
      );
      expect(['intent', 'action'], await ac.state()).toContain(plan.via);

      const timed = await ac.waitFor('a thoughts row with a latency', left(), async () =>
        (await ac.thoughts()).find((t) => t.latency_ms !== null && t.latency_ms > 0),
      );
      expect(timed.latency_ms, await ac.state()).toBeGreaterThan(0);
      expect(Date.now() - t0, await ac.state()).toBeLessThanOrEqual(BUDGET_MS + 2_000);
    });
  }, 300_000);
});
