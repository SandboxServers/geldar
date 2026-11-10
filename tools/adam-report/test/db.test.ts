import { describe, expect, it } from 'vitest';
import { loadRunData, type QueryClient } from '../src/db.ts';

interface FakeClient extends QueryClient {
  sql: string[];
  ended: number;
}

/** A fake client. `failWhen` makes one statement throw; every statement is recorded in order. */
function fakeClient(failWhen: (text: string) => boolean = () => false): FakeClient {
  const fake: FakeClient = {
    sql: [],
    ended: 0,
    connect: async () => undefined,
    query: async (text: string) => {
      fake.sql.push(text);
      if (failWhen(text)) throw new Error('fake failure');
      return { rows: [] };
    },
    end: async () => {
      fake.ended++;
    },
  };
  return fake;
}

const win = { lifeId: 'life-fake', from: new Date(0), to: new Date(1000) };
const isThoughts = (text: string) => text.includes('FROM thoughts');

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

  it('closes the client when BEGIN itself fails', async () => {
    const fake = fakeClient((text) => text === 'BEGIN READ ONLY');
    await expect(loadRunData(() => fake, win)).rejects.toThrow('fake failure');
    expect(fake.ended).toBe(1);
  });
});
