import { describe, expect, it } from 'vitest';
import { PgStore } from '../src/pg-store.ts';

/** A PgStore whose pool is a fake: every query rejects with `error`, and the statements are kept. */
function storeFailingWith(error: unknown): { store: PgStore; sql: string[]; args: unknown[][] } {
  const sql: string[] = [];
  const args: unknown[][] = [];
  const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1', startCredits: 240 });
  (store as unknown as { pool: unknown }).pool = {
    query: async (text: string, values: unknown[]) => {
      sql.push(text);
      args.push(values);
      throw error;
    },
  };
  return { store, sql, args };
}

const request = {
  identityHash: 'ab'.repeat(32),
  playerId: 'ag-x-01',
  lifeId: 'ag_x_01',
  name: 'x',
  harness: 'claude-code',
  tokenId: 'tk-1',
  tokenHash: Buffer.alloc(32),
};

describe('PgStore error mapping', () => {
  it.each([
    ['54000', 'the lifetime limit', 'limit'],
    ['23514', 'owner o is at the cap of 3 sovereign players', 'cap'],
    ['23505', 'duplicate key', 'taken'],
  ] as const)('createPlayer maps %s to %s', async (code, message, outcome) => {
    const { store } = storeFailingWith({ code, message });
    expect(await store.createPlayer(request)).toBe(outcome);
  });

  it('createPlayer rethrows a check violation that is not the cap, and any other error', async () => {
    await expect(
      storeFailingWith({ code: '23514', message: 'something else' }).store.createPlayer(request),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      storeFailingWith({ code: '42501', message: 'x' }).store.createPlayer(request),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('createPlayer sends no credits: the database holds the constant', async () => {
    const { store, args } = storeFailingWith({ code: '23505' });
    await store.createPlayer(request);
    expect(args[0]).toHaveLength(8);
    expect(args[0]).not.toContain(240);
  });

  it('retirePlayer and mintToken answer false for 42501 and rethrow the rest', async () => {
    expect(await storeFailingWith({ code: '42501' }).store.retirePlayer('ab'.repeat(32), 'p')).toBe(
      false,
    );
    expect(
      await storeFailingWith({ code: '42501' }).store.mintToken({
        identityHash: 'ab'.repeat(32),
        playerId: 'p',
        tokenId: 't',
        tokenHash: Buffer.alloc(32),
      }),
    ).toBe(false);
    await expect(
      storeFailingWith({ code: '40001' }).store.retirePlayer('ab'.repeat(32), 'p'),
    ).rejects.toMatchObject({ code: '40001' });
  });

  it('createOwner goes through register_create_owner and maps nothing itself', async () => {
    const { store, sql } = storeFailingWith({ code: '23505' });
    await expect(
      store.createOwner(
        { identityHash: 'ab'.repeat(32), provider: 'github', display: 'd' },
        'reg-1',
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(sql[0]).toContain('register_create_owner');
  });
});
