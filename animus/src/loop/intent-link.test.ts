import { describe, expect, it } from 'vitest';
import { FakeMemoryStore } from '../fakes/memory.fakes.ts';
import { INTENT_LINK_BUDGET_MS, IntentLinker } from './intent-link.ts';

const LIFE = 'ag_adam_01';
const INTENT = 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5';
const THOUGHT = 'th_01HZX3V9Q4M2K8R7T6Y5W4E3D6';

/** A sleep that records each wait and returns at once. */
function recordingSleep() {
  const waits: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  return { waits, sleep };
}

/** Makes a linker over `store` and returns it with its log lines. */
function linkerOver(store: FakeMemoryStore, sleep: (ms: number) => Promise<void>) {
  const lines: Record<string, unknown>[] = [];
  const linker = new IntentLinker({
    journal: store,
    lifeId: LIFE,
    sleep: (ms) => sleep(ms),
    log: (line) => lines.push(line),
  });
  return { linker, lines };
}

describe('IntentLinker', () => {
  it('links at once when the intent row is already there', async () => {
    const store = new FakeMemoryStore();
    store.addIntentRow(INTENT);
    const { waits } = recordingSleep();
    const { linker, lines } = linkerOver(store, async () => {});
    linker.link(INTENT, THOUGHT, new AbortController().signal);
    await linker.settled();

    expect(store.intentThought(INTENT)).toBe(THOUGHT);
    expect(waits).toEqual([]);
    expect(lines).toEqual([
      expect.objectContaining({
        event: 'intent_linked',
        life_id: LIFE,
        intent_id: INTENT,
        thought_id: THOUGHT,
        attempts: 1,
      }),
    ]);
  });

  it('waits for the event sink to write the row, with a doubling backoff', async () => {
    const store = new FakeMemoryStore();
    const { waits, sleep } = recordingSleep();
    const { linker, lines } = linkerOver(store, async (ms) => {
      await sleep(ms);
      // The sink writes the row during the second wait.
      if (waits.length === 2) store.addIntentRow(INTENT);
    });
    linker.link(INTENT, THOUGHT, new AbortController().signal);
    await linker.settled();

    expect(store.intentThought(INTENT)).toBe(THOUGHT);
    expect(waits).toEqual([250, 500]);
    expect(lines[0]).toMatchObject({ event: 'intent_linked', attempts: 3 });
  });

  it('gives up after the budget, having waited exactly that long', async () => {
    const store = new FakeMemoryStore();
    const { waits, sleep } = recordingSleep();
    const { linker, lines } = linkerOver(store, sleep);
    linker.link(INTENT, THOUGHT, new AbortController().signal);
    await linker.settled();

    expect(store.intentThought(INTENT)).toBeUndefined();
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(INTENT_LINK_BUDGET_MS);
    expect(Math.max(...waits)).toBeLessThanOrEqual(2_000);
    expect(lines).toEqual([
      expect.objectContaining({ event: 'intent_link_gave_up', attempts: waits.length + 1 }),
    ]);
  });

  it('keeps trying through journal errors and counts them', async () => {
    const store = new FakeMemoryStore();
    store.addIntentRow(INTENT);
    let failures = 2;
    // The first two writes fail as a dropped connection would; then the fake answers as usual.
    const flaky = {
      linkIntent: async (intentId: string, thoughtId: string): Promise<boolean> => {
        if (failures-- > 0) throw new Error('connection reset');
        return store.linkIntent(intentId, thoughtId);
      },
    } as unknown as FakeMemoryStore;
    const { waits, sleep } = recordingSleep();
    const { linker, lines } = linkerOver(flaky, sleep);
    linker.link(INTENT, THOUGHT, new AbortController().signal);
    await linker.settled();

    expect(store.intentThought(INTENT)).toBe(THOUGHT);
    expect(waits).toEqual([250, 500]);
    expect(lines[0]).toMatchObject({ event: 'intent_linked', attempts: 3, journal_errors: 2 });
  });

  it('stops at once when the loop stops', async () => {
    const store = new FakeMemoryStore();
    const { waits, sleep } = recordingSleep();
    const { linker, lines } = linkerOver(store, sleep);
    const abort = new AbortController();
    abort.abort();
    linker.link(INTENT, THOUGHT, abort.signal);
    await linker.settled();

    expect(waits).toEqual([]);
    expect(lines).toEqual([expect.objectContaining({ event: 'intent_link_gave_up', attempts: 1 })]);
  });

  it('does not hold the caller: link returns before the row exists', () => {
    const store = new FakeMemoryStore();
    const { linker } = linkerOver(store, () => new Promise(() => {}));
    linker.link(INTENT, THOUGHT, new AbortController().signal);
    expect(store.intentThought(INTENT)).toBeUndefined();
  });
});
