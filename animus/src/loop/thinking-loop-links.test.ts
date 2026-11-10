import { describe, expect, it } from 'vitest';
import { loadAnimusConfig } from '../config.ts';
import { newId } from '../ids.ts';
import { makeDecision, makeRig, OPTIONS, VALID_THOUGHT } from './loop-fixtures.ts';
import { loopOptionsFromConfig } from './thinking-loop.ts';

describe('ThinkingLoop: the intent links to its thought', () => {
  it('sets the intent row thought_id once the sink has written the row', async () => {
    const rig = await makeRig([{ text: VALID_THOUGHT }], { deps: { sleep: async () => {} } });
    const result = await rig.loop.handle(makeDecision('idle'));
    const plan = result.plan;
    expect(result.ack?.accepted).toBe(true);
    const intentId = plan?.intent_id;
    if (plan === null || intentId === undefined) throw new Error('the plan has no intent');

    // The sink projects the accepted intent after the plan was acknowledged.
    expect(rig.store.intentThought(intentId)).toBeUndefined();
    rig.store.addIntentRow(intentId);
    await rig.loop.settleLinks();

    expect(rig.store.intentThought(intentId)).toBe(plan.thought_id);
  });

  it('does not link a plan the Body refused', async () => {
    const rig = await makeRig([{ text: VALID_THOUGHT }], {
      ack: {
        thought_id: newId('th'),
        accepted: false,
        rejection: { reason: 'invalid_plan', detail: 'refused in the test' },
      },
      deps: { sleep: async () => {} },
    });
    const result = await rig.loop.handle(makeDecision('idle'));
    const intentId = result.plan?.intent_id;
    expect(result.ack?.accepted).toBe(false);
    if (intentId === undefined) throw new Error('the plan has no intent');

    // The row exists, so only the refusal keeps the link from being written.
    rig.store.addIntentRow(intentId);
    await rig.loop.settleLinks();
    expect(rig.store.intentThought(intentId)).toBeNull();
  });
});

describe('loopOptionsFromConfig', () => {
  it('reads the model, its pin and the plan window from the shard file', async () => {
    const config = await loadAnimusConfig({ env: {}, allowPlaceholders: true });
    const options = loopOptionsFromConfig(config, OPTIONS.versions);
    expect(options.lifeId).toBe(config.agent.username);
    expect(options.model).toBe(config.models[config.runTier]?.[0]);
    expect(options.modelConfig.length).toBeLessThanOrEqual(256);
    expect(options.modelConfig).toContain(options.model);
    expect(options.expiresAfterTicks).toBe(config.plan.expiresAfterTicks);
    expect(options.thought).toBe(config.thought);
  });
});
