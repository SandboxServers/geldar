import { describe, expect, it } from 'vitest';
import { JOURNAL_KEEP } from '../ports.ts';
import { FakeJournalStore } from './stores.fakes.ts';

describe('FakeJournalStore.recent', () => {
  it('returns at most the JOURNAL_KEEP window, as PgJournalStore does', async () => {
    const store = new FakeJournalStore();
    for (let i = 0; i < JOURNAL_KEEP + 5; i++) {
      await store.append('ag_jason_01', `line ${i}`, i);
    }
    const wide = await store.recent('ag_jason_01', 5_000);
    expect(wide).toHaveLength(JOURNAL_KEEP);
    expect(wide[0]?.text).toBe('line 5');
    expect(wide.at(-1)?.text).toBe(`line ${JOURNAL_KEEP + 4}`);
    expect(await store.recent('ag_jason_01', 3)).toHaveLength(3);
  });

  it('refuses a limit below 1, as PgJournalStore does', async () => {
    await expect(new FakeJournalStore().recent('ag_jason_01', 0)).rejects.toThrow(RangeError);
  });
});
