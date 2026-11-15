import { describe, expect, it, vi } from 'vitest';
import { cancelForDeath } from './death-cancel.ts';
import {
  executorHarness,
  planFor,
  type scriptedProgram,
  thought,
  waits,
} from './executor.fakes.ts';

type Program = ReturnType<typeof scriptedProgram>;

describe('cancelForDeath: the previous life stops at death', () => {
  it('ends the running intent, aborts the running action, and no step starts after', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    expect(h.executor.intentState).toBe('running');
    const started = (h.program.current as Program).log.started.length;
    const cancel = vi.spyOn(h.runtime, 'cancelAction');

    await cancelForDeath(h.executor, () => h.revision.current);
    expect(cancel).toHaveBeenCalled();
    expect(h.executor.intentState).toBeNull();
    expect(h.sink.intents.at(-1)?.state).toBe('interrupted');
    expect(h.sink.intents.at(-1)?.detail).toBe('the Body died');

    // The respawn and the ticks after it run no step of the old intent.
    await h.executor.onTick(1);
    await h.executor.onTick(2);
    expect((h.program.current as Program).log.started.length).toBe(started);
    expect(h.executor.intentState).toBeNull();
  });

  it('refuses a plan made before the death as stale, and accepts one made after it', async () => {
    const h = executorHarness();
    await cancelForDeath(h.executor, () => h.revision.current);

    const before = await h.executor.submit(thought({ actions: waits(1) }), planFor(1, { n: 2 }));
    expect(before.rejection?.reason).toBe('stale_snapshot');
    expect(before.rejection?.detail).toBe(
      'plan revision 5 was made before the Body died at revision 5',
    );
    expect(before.actions).toEqual([]);

    h.revision.current = 6;
    const after = await h.executor.submit(
      thought({ actions: waits(1) }),
      planFor(1, { n: 3, snapshotRevision: 6 }),
    );
    expect(after.rejection).toBeNull();
    expect(after.actions).toHaveLength(1);
  });

  it('does nothing harmful with no intent running, and a second death is safe', async () => {
    const h = executorHarness();
    await expect(cancelForDeath(h.executor, () => h.revision.current)).resolves.toBeUndefined();
    await expect(cancelForDeath(h.executor, () => h.revision.current)).resolves.toBeUndefined();
    expect(h.executor.intentState).toBeNull();
  });
});
