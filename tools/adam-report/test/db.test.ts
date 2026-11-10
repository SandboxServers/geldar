import { describe, expect, it } from 'vitest';
import { loadRunData, type QueryClient } from '../src/db.ts';

interface FakeClient extends QueryClient {
  sql: string[];
  ended: number;
}

/**
 * A fake client. `failWhen` makes one statement throw; `rowsFor` gives the rows of a statement.
 * Every statement is recorded in order.
 */
function fakeClient(
  failWhen: (text: string) => boolean = () => false,
  rowsFor: (text: string) => Record<string, unknown>[] = () => [],
): FakeClient {
  const fake: FakeClient = {
    sql: [],
    ended: 0,
    connect: async () => undefined,
    query: async (text: string) => {
      fake.sql.push(text);
      if (failWhen(text)) throw new Error('fake failure');
      return { rows: rowsFor(text) };
    },
    end: async () => {
      fake.ended++;
    },
  };
  return fake;
}

const win = { lifeId: 'life-fake', from: new Date(0), to: new Date(1000) };
const isThoughts = (text: string) => text.includes('FROM thoughts');

describe('loadRunData reads only the window', () => {
  it('every statement that reads a run table is bound to the window, with its values', async () => {
    const seen: { text: string; values: unknown[] }[] = [];
    const client: QueryClient = {
      connect: async () => undefined,
      query: async (text: string, values?: unknown[]) => {
        seen.push({ text, values: values ?? [] });
        return { rows: [] };
      },
      end: async () => undefined,
    };
    await loadRunData(() => client, win);
    const runTables = [
      'FROM thoughts',
      'FROM intents',
      'FROM actions',
      'FROM receipts',
      'FROM events',
    ];
    const reads = seen.filter((s) => runTables.some((t) => s.text.includes(t)));
    expect(reads.map((s) => s.text.split('\n')[0])).toHaveLength(5);
    for (const s of reads) {
      expect(s.text).toMatch(/\$2/);
      expect(s.values).toEqual(['life-fake', win.from, win.to]);
    }
  });
});

describe('loadRunData with a fake client', () => {
  it('reads inside one read-only transaction, commits, and closes the client', async () => {
    const fake = fakeClient();
    const data = await loadRunData(() => fake, win);
    expect(fake.sql[0]).toBe('BEGIN READ ONLY');
    expect(fake.sql.at(-1)).toBe('COMMIT');
    expect(fake.sql.some((s) => s.startsWith('ROLLBACK'))).toBe(false);
    expect(fake.ended).toBe(1);
    expect(data.thoughts).toEqual([]);
  });

  it('rolls back and closes the client when a read fails', async () => {
    const fake = fakeClient(isThoughts);
    await expect(loadRunData(() => fake, win)).rejects.toThrow('fake failure');
    expect(fake.sql).toContain('ROLLBACK');
    expect(fake.sql).not.toContain('COMMIT');
    expect(fake.ended).toBe(1);
  });

  it('closes the client when the abort signal is already set', async () => {
    const fake = fakeClient();
    const controller = new AbortController();
    controller.abort();
    await expect(loadRunData(() => fake, win, controller.signal)).rejects.toThrow();
    expect(fake.sql).toEqual(['BEGIN READ ONLY', 'ROLLBACK']);
    expect(fake.ended).toBe(1);
  });

  it('maps a place action to the block it places; other actions have none', async () => {
    const actionRows = [
      {
        action_id: 'a1',
        intent_id: null,
        body_generation: 1,
        state: 'completed',
        kind: 'place',
        place_block: 'white_bed',
      },
      {
        action_id: 'a2',
        intent_id: 'i1',
        body_generation: 1,
        state: 'completed',
        kind: 'mine',
        place_block: null,
      },
    ];
    const fake = fakeClient(undefined, (text) => (text.includes('FROM actions') ? actionRows : []));
    const data = await loadRunData(() => fake, win);
    expect(fake.sql.some((s) => s.includes("kind = 'place'"))).toBe(true);
    expect(data.actions).toEqual([
      {
        actionId: 'a1',
        intentId: null,
        bodyGeneration: 1,
        state: 'completed',
        kind: 'place',
        placeBlock: 'white_bed',
      },
      {
        actionId: 'a2',
        intentId: 'i1',
        bodyGeneration: 1,
        state: 'completed',
        kind: 'mine',
        placeBlock: null,
      },
    ]);
  });

  it('closes the client when BEGIN itself fails', async () => {
    const fake = fakeClient((text) => text === 'BEGIN READ ONLY');
    await expect(loadRunData(() => fake, win)).rejects.toThrow('fake failure');
    expect(fake.ended).toBe(1);
  });
});
