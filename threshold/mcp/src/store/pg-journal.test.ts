import { describe, expect, it } from 'vitest';
import { FakePool } from './pg-fakes.ts';
import { JOURNAL_LINE_MAX, PgJournalStore } from './pg-journal.ts';
import { PgPlayerDirectory } from './pg-players.ts';

describe('PgJournalStore', () => {
  it('appends a line with the life, the time and the text as bound values', async () => {
    const pool = new FakePool();
    const at = Date.UTC(2026, 10, 9, 8, 30);
    await new PgJournalStore(pool.asPool()).append('ag_jason_01', 'I saw the sea.', at);
    expect(pool.sent[0]?.text).toContain('INSERT INTO mcp_journal');
    expect(pool.sent[0]?.values).toEqual(['ag_jason_01', new Date(at), 'I saw the sea.']);
  });

  it('accepts exactly 4000 characters and refuses one more', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore(pool.asPool());
    await store.append('ag_jason_01', 'a'.repeat(JOURNAL_LINE_MAX), 0);
    await expect(store.append('ag_jason_01', 'a'.repeat(JOURNAL_LINE_MAX + 1), 0)).rejects.toThrow(
      RangeError,
    );
    expect(pool.sent).toHaveLength(1);
  });

  it('counts characters as Postgres does: 4000 emoji (8000 UTF-16 units) fit', async () => {
    const pool = new FakePool();
    const store = new PgJournalStore(pool.asPool());
    await store.append('ag_jason_01', '\u{1F600}'.repeat(JOURNAL_LINE_MAX), 0);
    expect(pool.sent).toHaveLength(1);
  });

  it('recent returns the newest lines oldest first, using a bound limit', async () => {
    const pool = new FakePool(() => ({
      rows: [
        { at: new Date(3_000), text: 'third' },
        { at: new Date(2_000), text: 'second' },
      ],
    }));
    const lines = await new PgJournalStore(pool.asPool()).recent('ag_jason_01', 2);
    expect(lines).toEqual([
      { at: 2_000, text: 'second' },
      { at: 3_000, text: 'third' },
    ]);
    expect(pool.sent[0]?.text).toContain('ORDER BY id DESC LIMIT $2');
    expect(pool.sent[0]?.values).toEqual(['ag_jason_01', 2]);
  });

  it('recent refuses a limit that is not a positive integer', async () => {
    const store = new PgJournalStore(new FakePool().asPool());
    await expect(store.recent('ag_jason_01', 0)).rejects.toThrow(RangeError);
    await expect(store.recent('ag_jason_01', 1.5)).rejects.toThrow(RangeError);
    await expect(store.recent('ag_jason_01', Number.NaN)).rejects.toThrow(RangeError);
  });
});

describe('PgPlayerDirectory', () => {
  it('maps the mcp_players row to a PlayerRecord, looked up by a bound id', async () => {
    const pool = new FakePool(() => ({
      rows: [
        {
          player_id: 'ag-jason-01',
          life_id: 'ag_jason_01',
          owner_id: 'owner-a',
          display_name: 'Jason',
          harness: 'claude',
          status: 'paused',
        },
      ],
    }));
    const player = await new PgPlayerDirectory(pool.asPool()).find('ag-jason-01');
    expect(player).toEqual({
      playerId: 'ag-jason-01',
      lifeId: 'ag_jason_01',
      ownerId: 'owner-a',
      displayName: 'Jason',
      harness: 'claude',
      status: 'paused',
    });
    expect(pool.sent[0]?.values).toEqual(['ag-jason-01']);
  });

  it('returns null for an unknown player', async () => {
    expect(await new PgPlayerDirectory(new FakePool().asPool()).find('ag-nobody-01')).toBeNull();
  });
});
