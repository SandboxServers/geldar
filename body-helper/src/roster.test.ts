import { describe, expect, it } from 'vitest';
import { LIFE_ID_SQL, type Query, rosterFromQuery } from './roster.ts';

function fakeQuery(rows: ReadonlyArray<{ name?: string | null; id?: string | null }>) {
  const calls: Array<{ sql: string; values: readonly string[] }> = [];
  const query: Query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows };
  };
  return { query, calls };
}

describe('roster life id port', () => {
  it('passes a valid id through and calls only the definer function', async () => {
    const fake = fakeQuery([{ id: 'ag_0123456789ab' }]);
    const roster = rosterFromQuery(fake.query);
    expect(await roster.lifeId('owner-1', 'Steve_01')).toBe('ag_0123456789ab');
    expect(fake.calls).toEqual([{ sql: LIFE_ID_SQL, values: ['owner-1', 'Steve_01'] }]);
    expect(LIFE_ID_SQL).toBe('SELECT supervisor_player_life_id($1, $2) AS id');
  });

  it('accepts the shortest and the longest valid id', async () => {
    const short = rosterFromQuery(fakeQuery([{ id: 'ag_a' }]).query);
    expect(await short.lifeId('o', 'n')).toBe('ag_a');
    const long = rosterFromQuery(fakeQuery([{ id: 'ag_abcdef012345' }]).query);
    expect(await long.lifeId('o', 'n')).toBe('ag_abcdef012345');
  });

  it('gives null when the function finds no roster row', async () => {
    const none = rosterFromQuery(fakeQuery([]).query);
    expect(await none.lifeId('owner-1', 'nobody')).toBeNull();
    const nullRow = rosterFromQuery(fakeQuery([{ id: null }]).query);
    expect(await nullRow.lifeId('owner-1', 'nobody')).toBeNull();
  });

  it.each([
    ['too long (13 after ag_)', 'ag_0123456789abc'],
    ['underscore in the id part', 'ag_01_23'],
    ['two underscores', 'ag__abc'],
    ['uppercase', 'ag_ABC'],
    ['uppercase prefix', 'AG_abc'],
    ['injection characters', "ag_x'; DROP TABLE mcp_roster;--"],
    ['shell metacharacters', 'ag_$(id)'],
    ['whitespace', 'ag_abc '],
    ['trailing newline', 'ag_abc\n'],
    ['empty', ''],
    ['only the prefix', 'ag_'],
    ['wrong prefix', 'ap_abc'],
  ])('refuses a hostile or malformed id (%s) as not on the roster', async (_label, hostile) => {
    const roster = rosterFromQuery(fakeQuery([{ id: hostile }]).query);
    expect(await roster.lifeId('owner-1', 'Steve_01')).toBeNull();
  });
});
