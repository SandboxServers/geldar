import { describe, expect, it } from 'vitest';
import { ModelError } from '../ports/index.ts';
import { due, event, LIFE, reflection, world } from './reflection.fixtures.ts';
import { ReflectionTrigger } from './trigger.ts';

describe('ReflectionTrigger', () => {
  it('reflects on a fresh day: admission at cost 2, one slot, memory applied, sleep day set', async () => {
    const w = await world([reflection()]);
    const out = await w.trigger.handle(due(3));
    expect(out).toMatchObject({ ran: true, result: { outcome: 'applied' } });
    expect(w.admission).toMatchObject({ asked: [2], settled: 1, released: 0 });
    expect(w.attention.calls).toEqual(['started', 'settled:fallback_hold']);
    expect((await w.store.loadDeterministic(LIFE, 0)).agent.lastSleepDay).toBe(3);
    const job = w.models.jobs[0];
    expect(job).toMatchObject({ model: 'fake-model', maxTokens: 1500, reasoning: 'on' });
    const row = w.store.thoughts[0];
    expect(row).toMatchObject({ wakeReason: 'reflection', creditsReserved: 2, creditsSettled: 2 });
    expect(w.publisher.published).toHaveLength(1);
    expect(w.publisher.published[0]).toMatchObject({
      type: 'reflection',
      agent_id: LIFE,
      payload: { thought_id: row?.thoughtId, outcome: 'applied', degraded: false },
    });
  });

  it('a second sleep on the same day starts no job and takes no credits', async () => {
    const w = await world([reflection(), reflection()]);
    await w.trigger.handle(due(3, 1000));
    const again = await w.trigger.handle(due(3, 1200));
    expect(again).toEqual({ ran: false, reason: 'already_slept' });
    expect(w.models.jobs).toHaveLength(1);
    expect(w.admission.asked).toEqual([2]);
    expect(w.attention.calls).toEqual([
      'started',
      'settled:fallback_hold',
      'started',
      'settled:fallback_hold',
    ]);
    const next = await w.trigger.handle(due(4, 25000));
    expect(next).toMatchObject({ ran: true });
    expect(w.models.jobs).toHaveLength(2);
  });

  it('starts no job when admission refuses', async () => {
    const w = await world([reflection()], { grant: false });
    expect(await w.trigger.handle(due(3))).toEqual({ ran: false, reason: 'not_admitted' });
    expect(w.models.jobs).toHaveLength(0);
    // The slot was claimed before the admission check, so the refusal settles it.
    expect(w.attention.calls).toEqual(['started', 'settled:fallback_hold']);
  });

  it('a thought that starts while the reflection loads gives the slot back without running', async () => {
    const w = await world([reflection()]);
    let polls = 0;
    const slot = new ReflectionTrigger({
      lifeId: LIFE,
      store: w.store,
      attention: w.attention,
      admission: { reserve: (cost) => ({ cost, settle() {}, release() {} }) },
      run: async () => {
        throw new Error('must not run');
      },
      thinking: () => ++polls > 1,
    });
    expect(await slot.handle(due(3))).toEqual({ ran: false, reason: 'busy' });
    expect(w.attention.calls).toEqual(['started', 'settled:fallback_hold']);
    expect(w.models.jobs).toHaveLength(0);
  });

  it('an already-slept due leaves nothing held for resume', async () => {
    const w = await world([reflection()]);
    expect(await w.trigger.handle(due(3, 1000))).toMatchObject({ ran: true });
    let busy = true;
    const slot = new ReflectionTrigger({
      lifeId: LIFE,
      store: w.store,
      attention: w.attention,
      admission: { reserve: (cost) => ({ cost, settle() {}, release() {} }) },
      run: async () => {
        throw new Error('must not run');
      },
      thinking: () => busy,
    });
    expect(await slot.handle(due(3, 1200))).toEqual({ ran: false, reason: 'busy' });
    busy = false;
    expect(await slot.handle(due(3, 1200))).toEqual({ ran: false, reason: 'already_slept' });
    expect(await slot.resume()).toBeNull();
  });

  it('holds a due reflection while the slot is taken and runs it on resume', async () => {
    const w = await world([reflection()]);
    let thinking = true;
    const slot = new ReflectionTrigger({
      lifeId: LIFE,
      store: w.store,
      attention: w.attention,
      admission: { reserve: (cost) => ({ cost, settle() {}, release() {} }) },
      run: async () => {
        throw new Error('must not run yet');
      },
      thinking: () => thinking,
    });
    expect(await slot.handle(due(3))).toEqual({ ran: false, reason: 'busy' });
    expect(w.attention.calls).toEqual([]);
    thinking = false;
    await expect(slot.resume()).rejects.toThrow('must not run yet');
    expect(w.attention.calls).toEqual(['started', 'settled:model_error']);
  });

  it('refuses a second reflection while one runs', async () => {
    const w = await world([reflection()]);
    const first = w.trigger.handle(due(3));
    const second = await w.trigger.handle(due(3, 1100));
    expect(second).toEqual({ ran: false, reason: 'busy' });
    await first;
    expect(w.models.jobs).toHaveLength(1);
  });

  it('degrades after fatigue_days without sleep: 2 memories, nothing else', async () => {
    const w = await world([reflection()], { agent: { lastSleepDay: 0, bornDay: 0 } });
    const out = await w.trigger.handle(due(3));
    expect(out).toMatchObject({ ran: true, result: { outcome: 'degraded' } });
    const loaded = await w.store.loadDeterministic(LIFE, 0);
    expect(loaded.goals).toEqual([]);
    expect(loaded.relationships).toEqual([]);
    expect(loaded.beliefs).toEqual([]);
    expect(loaded.agent.lastSleepDay).toBe(3);
    expect(w.prompts.renders[0]?.vars).toMatchObject({ degraded: true });
    expect(w.publisher.published[0]?.payload).toMatchObject({
      outcome: 'degraded',
      memories_written: 2,
    });
  });

  it('is not degraded when the fatigue rule is off or the gap is shorter', async () => {
    const off = await world([reflection()], {
      agent: { lastSleepDay: 0 },
      fatigueRule: false,
    });
    expect(await off.trigger.handle(due(9))).toMatchObject({ result: { outcome: 'applied' } });
    const near = await world([reflection()], { agent: { lastSleepDay: 1 } });
    expect(await near.trigger.handle(due(3))).toMatchObject({ result: { outcome: 'applied' } });
  });

  it('invalid output twice applies nothing, records the attempt and keeps the day open', async () => {
    const w = await world(['not json', '{"memories_to_keep": 5}']);
    const out = await w.trigger.handle(due(3));
    expect(out).toMatchObject({ ran: true, result: { outcome: 'invalid_output' } });
    expect(w.models.jobs).toHaveLength(2);
    expect(w.models.jobs[1]?.messages.at(-1)?.content).toContain('rejected');
    const loaded = await w.store.loadDeterministic(LIFE, 0);
    expect(loaded.agent.lastSleepDay).toBeNull();
    expect(loaded.goals).toEqual([]);
    expect(loaded.beliefs).toEqual([]);
    expect(w.store.thoughts).toHaveLength(1);
    expect(w.store.thoughts[0]).toMatchObject({
      wakeReason: 'reflection',
      rawOutput: '{"memories_to_keep": 5}',
    });
    expect(w.publisher.published[0]?.payload).toMatchObject({
      outcome: 'invalid_output',
      attempts: 2,
      memories_written: 0,
    });
    expect(w.attention.calls).toEqual(['started', 'settled:invalid_output']);
  });

  it('one invalid answer then a valid one is applied after the retry', async () => {
    const w = await world(['nope', reflection()]);
    const out = await w.trigger.handle(due(3));
    expect(out).toMatchObject({ result: { outcome: 'applied' } });
    expect(w.publisher.published[0]?.payload).toMatchObject({ attempts: 2 });
  });

  it('a model error applies nothing and is recorded', async () => {
    const w = await world([]);
    w.models.script(new ModelError('timeout', 'late'));
    const out = await w.trigger.handle(due(3));
    expect(out).toMatchObject({ result: { outcome: 'model_error' } });
    expect(w.models.jobs).toHaveLength(1);
    expect(w.store.thoughts).toHaveLength(1);
    expect((await w.store.loadDeterministic(LIFE, 0)).agent.lastSleepDay).toBeNull();
  });

  it('builds the digest from the events seen since the last reflection', async () => {
    const w = await world([reflection(), reflection()]);
    w.trigger.observe(
      event('speech', 10, { from: 'Wren', text: 'hello', distance: 3, own: false }),
    );
    await w.trigger.handle(due(3, 1000));
    const first = w.prompts.renders[0]?.vars as unknown as { digest: string };
    expect(first.digest).toContain('"Wren"');
    await w.trigger.handle(due(4, 25000));
    const second = w.prompts.renders[1]?.vars as unknown as { digest: string };
    expect(second.digest).not.toContain('"Wren"');
  });
});
