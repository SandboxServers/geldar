import { describe, expect, it } from 'vitest';
import { FakePool } from './pg-fakes.ts';
import { PgPlayerDirectory } from './pg-players.ts';

const JOIN = 'LEFT JOIN agents ON agents.agent_id = mcp_players.life_id';

const ROW = {
  player_id: 'ag-jason-01',
  life_id: 'ag_jason_01',
  owner_id: 'jo',
  display_name: 'Jason',
  harness: 'claude',
  status: 'active',
};

/** Answers like the database: the declared model is only in the row when the statement joins agents. */
function directoryAnswering(declaredModel: string | null) {
  const pool = new FakePool((text) =>
    text.includes(JOIN) ? { rows: [{ ...ROW, declared_model: declaredModel }] } : { rows: [ROW] },
  );
  return { pool, directory: new PgPlayerDirectory(pool.asPool()) };
}

describe('PgPlayerDirectory.find', () => {
  it('reads the declared model', async () => {
    const { directory } = directoryAnswering('claude-sonnet-5.5');
    const record = await directory.find('ag-jason-01');
    expect(record?.declaredModel).toBe('claude-sonnet-5.5');
    expect(record?.harness).toBe('claude');
  });

  it('joins agents on the life id and binds the player id', async () => {
    const { pool, directory } = directoryAnswering('claude-sonnet-5.5');
    await directory.find('ag-jason-01');
    expect(pool.sent[0]?.text).toContain(JOIN);
    expect(pool.sent[0]?.values).toEqual(['ag-jason-01']);
  });

  it('maps the self-reported placeholder to null', async () => {
    const { directory } = directoryAnswering('self-reported');
    expect((await directory.find('ag-jason-01'))?.declaredModel).toBeNull();
  });

  it('gives null when the life has no declared model', async () => {
    const { directory } = directoryAnswering(null);
    expect((await directory.find('ag-jason-01'))?.declaredModel).toBeNull();
  });

  it('returns null for an unknown player', async () => {
    const pool = new FakePool(() => ({ rows: [] }));
    expect(await new PgPlayerDirectory(pool.asPool()).find('ag-nobody-01')).toBeNull();
  });
});
