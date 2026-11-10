import { describe, expect, it } from 'vitest';
import { parseEntry } from './checkpoint.ts';
import { fakeId, LIFE, planFor, thought } from './executor.fakes.ts';
import { nextGeneration } from './generation.ts';
import { boot, buckets, entry, fakeKv, startIntent } from './restart.fakes.ts';

describe('nextGeneration', () => {
  it('starts at 1 and counts up by one per start', async () => {
    const kv = fakeKv();
    expect(await nextGeneration(kv, LIFE)).toBe(1);
    expect(await nextGeneration(kv, LIFE)).toBe(2);
    expect(await nextGeneration(kv, 'ag_other_01')).toBe(1);
    expect(kv.peek(LIFE)).toBe('2');
  });

  it('gives two starts that race different generations, once each', async () => {
    const kv = fakeKv({ gap: true });
    const got = await Promise.all([
      nextGeneration(kv, LIFE, { retryDelayMs: 0 }),
      nextGeneration(kv, LIFE, { retryDelayMs: 0 }),
    ]);
    expect([...got].sort()).toEqual([1, 2]);
    expect(kv.peek(LIFE)).toBe('2');
    const more = await Promise.all(
      [1, 2, 3].map(() => nextGeneration(kv, LIFE, { retryDelayMs: 0 })),
    );
    expect([...more].sort()).toEqual([3, 4, 5]);
  });

  it('throws on a stored value that is not a count, and after its attempts', async () => {
    const bad = fakeKv();
    bad.seed(LIFE, 'banana');
    await expect(nextGeneration(bad, LIFE)).rejects.toThrow(/banana/);
    const down = fakeKv();
    down.get = () => Promise.reject(new Error('down'));
    await expect(nextGeneration(down, LIFE, { attempts: 3, retryDelayMs: 0 })).rejects.toThrow(
      /3 attempts/,
    );
  });
});

describe('checkpointing the running intent', () => {
  it('saves after each step with the identity fields and deletes on the intent end', async () => {
    const kv = buckets();
    const b = await boot(kv);
    await startIntent(b);
    await b.body.executor.onTick(1);
    await b.body.executor.onTick(2);
    await b.body.checkpoints?.flush();
    const saved = parseEntry(kv.checkpoints.peek(LIFE) ?? '');
    expect(saved).toMatchObject({
      life_id: LIFE,
      body_generation: 1,
      intent_id: fakeId('in', 1),
      program: 'fake',
      checkpoint: { steps: 2 },
      expires_tick: 1000,
    });
    expect(saved?.intent.goal).toBe('test_goal');
    // A new intent replaces the running one, which ends cancelled: its checkpoint goes.
    await b.body.executor.submit(
      thought({ intent: { program: 'nope' } }),
      planFor(0, { n: 2, bodyGeneration: 1 }),
    );
    await b.body.checkpoints?.flush();
    expect(kv.checkpoints.peek(LIFE)).toBeUndefined();
    await b.stop();
  });

  it('a replacing intent overwrites the checkpoint of the one it replaces, with no delete before', async () => {
    const kv = buckets();
    const b = await boot(kv);
    await startIntent(b, 1);
    await b.body.checkpoints?.flush();
    const deletesBefore = kv.checkpoints.deletes;
    await startIntent(b, 2);
    await b.body.checkpoints?.flush();
    expect(kv.checkpoints.deletes).toBe(deletesBefore);
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.intent_id).toBe(fakeId('in', 2));
    await b.stop();
  });

  it('keeps the checkpoint when the Body stops, since that is a restart and not an end', async () => {
    const kv = buckets();
    const b = await boot(kv);
    await startIntent(b);
    await b.body.executor.onTick(1);
    await b.stop();
    expect(kv.checkpoints.peek(LIFE)).toBeDefined();
  });

  it('a failed write is logged and does not stop the step loop; the next step saves again', async () => {
    const kv = buckets();
    const b = await boot(kv);
    await startIntent(b);
    // Installing the intent already saved an entry (steps 0); step 1's write fails and leaves it.
    await b.body.checkpoints?.flush();
    kv.checkpoints.failPuts(1);
    await b.body.executor.onTick(1);
    await b.body.checkpoints?.flush();
    expect(b.lines.some((line) => line.includes('not written'))).toBe(true);
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.checkpoint).toEqual({ steps: 0 });
    await b.body.executor.onTick(2);
    await b.body.checkpoints?.flush();
    expect(b.made[0]?.log.steps).toBe(2);
    expect(b.body.executor.intentState).toBe('running');
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.checkpoint).toEqual({ steps: 2 });
    await b.stop();
  });
});

describe('restartBody', () => {
  it('resumes the saved program with its state and records the intent under the new generation', async () => {
    const kv = buckets();
    const first = await boot(kv);
    expect(first.generation).toBe(1);
    expect(first.outcome).toEqual({ kind: 'idle', reason: 'no_checkpoint' });
    await startIntent(first);
    for (const tick of [1, 2, 3]) await first.body.executor.onTick(tick);
    await first.stop();

    const second = await boot(kv, { tick: 10 });
    expect(second.generation).toBe(2);
    expect(second.outcome).toEqual({ kind: 'resumed', intentId: fakeId('in', 1) });
    expect(second.made[0]?.log.resumed).toEqual([{ steps: 3 }]);
    expect(second.made[0]?.log.started).toEqual([]);
    expect(second.body.executor.intentId).toBe(fakeId('in', 1));
    const states = second.records.intents.map((c) => [c.bodyGeneration, c.state]);
    expect(states).toEqual([
      [2, 'accepted'],
      [2, 'running'],
    ]);
    // The resumed intent keeps going and is saved under the new generation.
    await second.body.executor.onTick(11);
    await second.body.checkpoints?.flush();
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.body_generation).toBe(2);
    await second.stop();
  });

  it('keeps the original expiry: the resumed intent has only the ticks that were left', async () => {
    const kv = buckets();
    const first = await boot(kv);
    await startIntent(first);
    await first.body.executor.onTick(1);
    await first.stop();
    const second = await boot(kv, { tick: 990 });
    expect(second.outcome.kind).toBe('resumed');
    await second.body.executor.onTick(991);
    await second.body.checkpoints?.flush();
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.expires_tick).toBe(1000);
    await second.body.executor.onTick(1000);
    expect(second.records.wakes.map((w) => w.reason)).toEqual(['limit_reached']);
    await second.stop();
  });

  it('keeps the used block budget of a resumed intent', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry({ block_operations_used: 7 }));
    const b = await boot(kv, { tick: 10 });
    expect(b.outcome.kind).toBe('resumed');
    await b.body.executor.onTick(11);
    await b.body.checkpoints?.flush();
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.block_operations_used).toBe(7);
    await b.stop();
  });

  it('refuses a plan made for the generation before the restart', async () => {
    const kv = buckets();
    const first = await boot(kv);
    await first.stop();
    const second = await boot(kv);
    expect(second.generation).toBe(2);
    const result = await second.body.executor.submit(
      thought({ intent: {} }),
      planFor(0, { n: 7, bodyGeneration: first.generation }),
    );
    expect(result.rejection?.reason).toBe('stale_generation');
    expect(result.intent).toBe('none');
    expect(second.body.executor.intentId).toBeNull();
    await second.stop();
  });

  it('ignores a checkpoint written for another life', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry({ life_id: 'ag_dead_01' }));
    const b = await boot(kv);
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'other_life' });
    expect(b.made).toHaveLength(0);
    expect(b.body.executor.intentId).toBeNull();
    await b.stop();
  });

  it('ignores an expired checkpoint and removes it', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry({ expires_tick: 500 }));
    const b = await boot(kv, { tick: 500 });
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'expired' });
    expect(b.made).toHaveLength(0);
    expect(kv.checkpoints.peek(LIFE)).toBeUndefined();
    await b.stop();
  });

  it('closes the intent of an expired or unknown-program checkpoint as interrupted', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry({ expires_tick: 500, intent_id: 'in_lost' }));
    const expired = await boot(kv, { tick: 500 });
    expect(
      expired.records.intents.map((c) => [c.intentId, c.bodyGeneration, c.state, c.detail]),
    ).toEqual([['in_lost', expired.generation, 'interrupted', 'body_restarted']]);
    await expired.stop();
    kv.checkpoints.seed(LIFE, entry({ program: 'mystery', intent_id: 'in_other' }));
    const unknown = await boot(kv);
    expect(unknown.records.intents.map((c) => [c.intentId, c.state, c.detail])).toEqual([
      ['in_other', 'interrupted', 'body_restarted'],
    ]);
    await unknown.stop();
  });

  it('ignores a checkpoint whose program is not registered, and one that is not an entry', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry({ program: 'mystery' }));
    const b = await boot(kv);
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'unknown_program' });
    await b.stop();
    kv.checkpoints.seed(LIFE, '{"nope":true}');
    const c = await boot(kv);
    expect(c.outcome).toEqual({ kind: 'idle', reason: 'no_checkpoint' });
    expect(c.lines.some((line) => line.includes('not a valid entry'))).toBe(true);
    await c.stop();
  });
});

describe('the no_plan wake', () => {
  /** A schedule the test fires by hand. */
  function manualTimer() {
    const timers: Array<{ fire: () => void; ms: number; cancelled: boolean }> = [];
    return {
      timers,
      schedule: (fire: () => void, ms: number) => {
        const timer = { fire, ms, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    };
  }

  it('is raised after 45 s when an idle Body got no plan', async () => {
    const timer = manualTimer();
    const b = await boot(buckets(), { schedule: timer.schedule });
    expect(timer.timers.map((t) => t.ms)).toEqual([45_000]);
    expect(b.records.wakes).toEqual([]);
    timer.timers[0]?.fire();
    expect(b.records.wakes.map((w) => [w.reason, w.intentId])).toEqual([['no_plan', null]]);
    await b.stop();
  });

  it('is not raised when a plan arrived in the meantime, nor after a resume', async () => {
    const timer = manualTimer();
    const kv = buckets();
    const b = await boot(kv, { schedule: timer.schedule });
    await b.body.executor.submit(thought({ actions: [] }), planFor(0, { bodyGeneration: 1 }));
    timer.timers[0]?.fire();
    expect(b.records.wakes).toEqual([]);
    await startIntent(b, 2);
    await b.body.executor.onTick(1);
    await b.stop();
    const again = await boot(kv, { schedule: timer.schedule });
    expect(again.outcome.kind).toBe('resumed');
    expect(timer.timers).toHaveLength(1);
    await again.stop();
  });

  it('is cancelled when the Body stops', async () => {
    const timer = manualTimer();
    const b = await boot(buckets(), { schedule: timer.schedule });
    await b.stop();
    expect(timer.timers[0]?.cancelled).toBe(true);
  });
});
