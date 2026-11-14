import { describe, expect, it } from 'vitest';
import type { FlagQuery } from '../src/admin.ts';
import { OwnerRefusedError, ownerAgentLoaders } from '../src/owner-agents-pg.ts';

const PLAYER_ROW = {
  player_id: 'ag-p1',
  display_name: 'p1',
  status: 'active',
  public_camera: true,
  thoughts_delayed_public: false,
};

function fakeDb(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db: FlagQuery = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      return { rows };
    },
  };
  return { db, calls };
}

function failingDb(err: unknown): FlagQuery {
  return {
    query: async () => {
      throw err;
    },
  };
}

function sqlError(code: string): Error {
  return Object.assign(new Error('database error'), { code });
}

describe('ownerAgentLoaders (migration 0036 definer functions, keyed by owner id)', () => {
  it('lists the owner players as agent views stamped with the owner id and the flags', async () => {
    const { db, calls } = fakeDb([PLAYER_ROW]);
    const loaders = ownerAgentLoaders(db);
    expect(await loaders.listAgents('reg-own')).toEqual([
      {
        playerId: 'ag-p1',
        ownerId: 'reg-own',
        displayName: 'p1',
        status: 'active',
        publicCamera: true,
        thoughtsDelayedPublic: false,
      },
    ]);
    expect(calls).toEqual([
      { text: 'SELECT * FROM register_owner_list_players($1)', values: ['reg-own'] },
    ]);
  });

  it('an unknown owner lists nothing (an empty array, not a refusal)', async () => {
    const loaders = ownerAgentLoaders(fakeDb([]).db);
    expect(await loaders.listAgents('reg-nobody')).toEqual([]);
  });

  it('gets one of the owner players with the owner and player ids passed in order', async () => {
    const { db, calls } = fakeDb([PLAYER_ROW]);
    const agent = await ownerAgentLoaders(db).agents('reg-own', 'ag-p1');
    expect(agent?.playerId).toBe('ag-p1');
    expect(agent?.ownerId).toBe('reg-own');
    expect(calls).toEqual([
      { text: 'SELECT * FROM register_owner_get_player($1, $2)', values: ['reg-own', 'ag-p1'] },
    ]);
  });

  it('a foreign or unknown player comes back as null (the definer function returns no row)', async () => {
    const loaders = ownerAgentLoaders(fakeDb([]).db);
    expect(await loaders.agents('reg-own', 'ag-foreign')).toBeNull();
  });

  it('maps a banned owner (SQLSTATE 42501) to OwnerRefusedError on list, never an empty list', async () => {
    const loaders = ownerAgentLoaders(failingDb(sqlError('42501')));
    await expect(loaders.listAgents('reg-ban')).rejects.toBeInstanceOf(OwnerRefusedError);
  });

  it('maps a banned owner (SQLSTATE 42501) to OwnerRefusedError on get, never null', async () => {
    const loaders = ownerAgentLoaders(failingDb(sqlError('42501')));
    await expect(loaders.agents('reg-ban', 'ag-p1')).rejects.toBeInstanceOf(OwnerRefusedError);
  });

  it('propagates other database errors unchanged', async () => {
    const err = sqlError('08006');
    const loaders = ownerAgentLoaders(failingDb(err));
    await expect(loaders.listAgents('reg-own')).rejects.toBe(err);
    await expect(loaders.agents('reg-own', 'ag-p1')).rejects.toBe(err);
  });

  it('propagates an error without a SQLSTATE unchanged', async () => {
    const err = new Error('pool closed');
    await expect(ownerAgentLoaders(failingDb(err)).listAgents('reg-own')).rejects.toBe(err);
  });
});
