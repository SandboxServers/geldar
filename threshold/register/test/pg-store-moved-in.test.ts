import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PgStore } from '../src/pg-store.ts';

const IDENTITY = 'ab'.repeat(32);

/** A store whose pool answers every statement with the given rows (or rejects), and keeps each statement. */
function movedStore(
  rows: unknown[],
  fail?: Error,
): { store: PgStore; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const store = new PgStore('postgres://user@127.0.0.1:1/none', { shard: 's1' });
  (store as unknown as { pool: unknown }).pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      if (fail) throw fail;
      return { rows };
    },
  };
  return { store, calls };
}

describe('PgStore movedInPlayers (the delete-guard reader)', () => {
  it('reads the players through register_list_players, joined to the set-owner audit rows', async () => {
    const { store, calls } = movedStore([{ status: 'active' }]);
    await store.movedInPlayers(IDENTITY);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.text).toContain('register_list_players($1)');
    expect(call?.text).toContain("a.action = 'player.set_owner'");
    expect(call?.text).toContain('a.target = p.player_id');
    expect(call?.values).toHaveLength(1);
  });

  it('maps each row to its status, live and retired alike', async () => {
    const { store } = movedStore([{ status: 'active' }, { status: 'retired' }]);
    expect(await store.movedInPlayers(IDENTITY)).toEqual([
      { status: 'active' },
      { status: 'retired' },
    ]);
  });

  it('answers an empty list when no player has a set-owner row', async () => {
    const { store } = movedStore([]);
    expect(await store.movedInPlayers(IDENTITY)).toEqual([]);
  });

  it('a query error throws to the caller, so the delete fails closed', async () => {
    const { store } = movedStore([], new Error('database down'));
    await expect(store.movedInPlayers(IDENTITY)).rejects.toThrow('database down');
  });
});

describe('the writer and the reader share the set-owner action literal', () => {
  // The writer (mcp-tokens player set-owner) and this reader are two packages linked only by the string.
  const root = new URL('../../../', import.meta.url);

  it('tools/mcp-tokens writes player.set_owner', () => {
    const writer = readFileSync(new URL('tools/mcp-tokens/src/player-owner.ts', root), 'utf8');
    expect(writer).toContain("'player.set_owner'");
  });

  it('pg-store reads player.set_owner', () => {
    const reader = readFileSync(new URL('threshold/register/src/pg-store.ts', root), 'utf8');
    expect(reader).toContain("a.action = 'player.set_owner'");
  });
});
