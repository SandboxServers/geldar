import { describe, expect, it } from 'vitest';
import { PgStore } from '../src/pg-store.ts';

/** A PgStore whose pool is a fake: every query rejects with `error`, and the statements are kept. */
function storeFailingWith(error: unknown): { store: PgStore; sql: string[]; args: unknown[][] } {
  const sql: string[] = [];
  const args: unknown[][] = [];
  const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
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

  it('findOwner reads the banned flag from the definer function (F25)', async () => {
    const storeAnswering = (rows: unknown[]): PgStore => {
      const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
      (store as unknown as { pool: unknown }).pool = { query: async () => ({ rows }) };
      return store;
    };
    expect(await storeAnswering([{ owner_id: 'o', banned: true }]).findOwner('ab')).toEqual({
      ownerId: 'o',
      banned: true,
    });
    expect(await storeAnswering([{ owner_id: 'o', banned: false }]).findOwner('ab')).toEqual({
      ownerId: 'o',
      banned: false,
    });
    expect(await storeAnswering([]).findOwner('ab')).toBeNull();
    // A tombstone (owner NULL, 0039) is refused like a ban and never becomes the owner 'null' (F4).
    const tombstone = await storeAnswering([{ owner_id: null, banned: false }]).findOwner('ab');
    expect(tombstone?.banned).toBe(true);
    expect(tombstone?.ownerId).not.toBe('null');
  });

  it('createOwner goes through register_create_owner and maps nothing itself', async () => {
    const { store, sql } = ownerStore((text) =>
      text.includes('register_create_owner') ? { code: '23505' } : undefined,
    );
    await expect(store.createOwner(owner, 'reg-1', 'draft-1')).rejects.toMatchObject({
      code: '23505',
    });
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('register_create_owner');
  });

  it('createOwner writes the owner and the consent row in one transaction (C7-08)', async () => {
    const { store, sql } = ownerStore(() => undefined);
    await store.createOwner(owner, 'reg-1', 'draft-1');
    expect(sql.map((text) => text.split(' ')[0])).toEqual([
      'BEGIN',
      'SELECT',
      'INSERT',
      'COMMIT',
      'RELEASE',
    ]);
    expect(sql[2]).toContain('register_consents');
  });

  it('a failed consent insert rolls the owner back and rethrows: nothing commits', async () => {
    const { store, sql } = ownerStore((text) =>
      text.includes('register_consents') ? { code: '23505', message: 'duplicate' } : undefined,
    );
    await expect(store.createOwner(owner, 'reg-1', 'draft-1')).rejects.toMatchObject({
      code: '23505',
    });
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(sql.at(-1)).toBe('RELEASE');
  });

  it('a failed owner write never reaches the consent insert', async () => {
    const { store, sql } = ownerStore((text) =>
      text.includes('register_create_owner') ? { code: '42501' } : undefined,
    );
    await expect(store.createOwner(owner, 'reg-1', 'draft-1')).rejects.toMatchObject({
      code: '42501',
    });
    expect(sql.some((text) => text.includes('register_consents'))).toBe(false);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });
});

describe('PgStore listPlayers flags (F3)', () => {
  const identity = 'ab'.repeat(32);
  const players = [
    { player_id: 'ag-a-01', display_name: 'A', harness: 'claude-code', status: 'live' },
    { player_id: 'ag-b-01', display_name: 'B', harness: 'claude-code', status: 'live' },
  ];

  /** A pool that answers each statement by its name, and keeps every statement with its values. */
  function listStore(
    owner: unknown[],
    flags: unknown[],
  ): { store: PgStore; calls: Array<{ text: string; values: unknown[] }> } {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
    (store as unknown as { pool: unknown }).pool = {
      query: async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        if (text.includes('register_list_players')) return { rows: players };
        if (text.includes('register_find_owner')) return { rows: owner };
        return { rows: flags };
      },
    };
    return { store, calls };
  }

  it('reads the players, then the owner, then the flags keyed by the owner id', async () => {
    const { store, calls } = listStore([{ owner_id: 'o1', banned: false }], []);
    await store.listPlayers(identity);
    expect(calls.map((c) => c.text.match(/register_\w+/)?.[0])).toEqual([
      'register_list_players',
      'register_find_owner',
      'register_owner_list_players',
    ]);
    expect(calls[2]?.values).toEqual(['o1']);
  });

  it('maps each flag to its own field, and a player with no flag row to false', async () => {
    const { store } = listStore(
      [{ owner_id: 'o1', banned: false }],
      [
        { player_id: 'ag-a-01', public_camera: false, thoughts_delayed_public: true },
        { player_id: 'ag-b-01', public_camera: true, thoughts_delayed_public: false },
      ],
    );
    expect(await store.listPlayers(identity)).toEqual([
      {
        playerId: 'ag-a-01',
        name: 'A',
        harness: 'claude-code',
        status: 'live',
        publicCamera: false,
        thoughtsDelayedPublic: true,
      },
      {
        playerId: 'ag-b-01',
        name: 'B',
        harness: 'claude-code',
        status: 'live',
        publicCamera: true,
        thoughtsDelayedPublic: false,
      },
    ]);
    const { store: missing } = listStore([{ owner_id: 'o1', banned: false }], []);
    expect((await missing.listPlayers(identity)).map((p) => p.publicCamera)).toEqual([
      false,
      false,
    ]);
  });

  it('skips the flag query for a banned owner: every flag reads false', async () => {
    const { store, calls } = listStore(
      [{ owner_id: 'o1', banned: true }],
      [{ player_id: 'ag-a-01', public_camera: true, thoughts_delayed_public: true }],
    );
    const rows = await store.listPlayers(identity);
    expect(calls.some((c) => c.text.includes('register_owner_list_players'))).toBe(false);
    expect(rows.map((p) => [p.publicCamera, p.thoughtsDelayedPublic])).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it('skips the flag query when no owner is found: every flag reads false', async () => {
    const { store, calls } = listStore(
      [],
      [{ player_id: 'ag-a-01', public_camera: true, thoughts_delayed_public: true }],
    );
    const rows = await store.listPlayers(identity);
    expect(calls.some((c) => c.text.includes('register_owner_list_players'))).toBe(false);
    expect(rows.every((p) => !p.publicCamera && !p.thoughtsDelayedPublic)).toBe(true);
  });
});

const owner = { identityHash: 'ab'.repeat(32), provider: 'github', display: 'd' };

/**
 * A PgStore whose pool hands out one client. `failOn` gives the error for a statement, or
 * undefined to let it succeed. Every statement, including BEGIN, COMMIT, ROLLBACK, is kept.
 */
function ownerStore(failOn: (text: string) => unknown): { store: PgStore; sql: string[] } {
  const sql: string[] = [];
  const client = {
    query: async (text: string) => {
      sql.push(text);
      const error = failOn(text);
      if (error !== undefined) throw error;
      return { rows: [] };
    },
    release: () => {
      sql.push('RELEASE');
    },
  };
  const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
  (store as unknown as { pool: unknown }).pool = {
    connect: async () => client,
  };
  return { store, sql };
}
