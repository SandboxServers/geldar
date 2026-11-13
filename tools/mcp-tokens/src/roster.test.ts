import { describe, expect, it } from 'vitest';
import type { Row, Sql } from './owners.ts';
import {
  addRosterName,
  checkRosterStart,
  listRoster,
  parseMaxAgents,
  ROSTER_LIMIT,
  ROSTER_NOT_LISTED,
  ROSTER_TAKEN,
  RosterError,
  readRosterNames,
  removeRosterName,
  seedRoster,
} from './roster.ts';

interface Entry {
  owner_id: string;
  max_agents: number;
}

/**
 * An in-memory roster and player table. BEGIN keeps a copy and ROLLBACK restores it, so an abort
 * is visible in the roster. `failInsert` makes the N-th roster insert throw (a mid-seed failure).
 * The player match is case-insensitive, as the database comparison is for display names.
 */
class FakeRoster implements Sql {
  roster = new Map<string, Entry>();
  players: Array<{ display_name: string; status: string }> = [];
  log: string[] = [];
  failInsert = 0;
  private inserts = 0;
  private saved: Map<string, Entry> | undefined;

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.log.push(text);
    if (text === 'BEGIN') {
      this.saved = new Map(this.roster);
      return { rows: [] };
    }
    if (text === 'COMMIT') {
      this.saved = undefined;
      return { rows: [] };
    }
    if (text === 'ROLLBACK') {
      if (this.saved !== undefined) this.roster = this.saved;
      this.saved = undefined;
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_roster')) {
      this.inserts += 1;
      if (this.inserts === this.failInsert) {
        throw Object.assign(new Error('injected failure'), { code: 'XX000' });
      }
      const name = String(values[0]);
      if (this.roster.has(name)) {
        if (text.includes('ON CONFLICT')) return { rows: [] };
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      this.roster.set(name, { owner_id: String(values[1]), max_agents: Number(values[2]) });
      return { rows: [{ player_name: name }] };
    }
    if (text.startsWith('DELETE FROM mcp_roster')) {
      // The fake honours the owner scope only when the statement has it, so a dropped
      // `AND owner_id = $2` changes what the fake does and a test can see it.
      const scoped = text.includes('owner_id = $2');
      const entry = this.roster.get(String(values[0]));
      if (entry === undefined || (scoped && entry.owner_id !== values[1])) return { rows: [] };
      this.roster.delete(String(values[0]));
      return { rows: [{ player_name: values[0] }] };
    }
    if (text.includes('FOR UPDATE') && text.includes('FROM mcp_roster')) {
      const entry = this.roster.get(String(values[0]));
      return { rows: entry === undefined ? [] : [{ ...entry }] };
    }
    if (text.startsWith('SELECT player_name, owner_id')) {
      const rows = [...this.roster.entries()]
        .filter(([, e]) => values.length === 0 || e.owner_id === values[0])
        .map(([name, e]) => ({
          player_name: name,
          owner_id: e.owner_id,
          max_agents: e.max_agents,
        }));
      return { rows };
    }
    if (text.includes('display_name')) {
      const wanted = String(values[0]).toLowerCase();
      const n = this.players.filter(
        (p) => p.display_name.toLowerCase() === wanted && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    throw new Error(`FakeRoster: unexpected statement ${text}`);
  }
}

/** Rejects with the stable code, or fails the test when the call resolves. */
async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RosterError);
  expect((error as RosterError).code).toBe(code);
}

describe('roster add', () => {
  it('refuses a name another owner already holds, and leaves that row alone', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'Jason');
    await expectCode(addRosterName(sql, 'bob', 'Jason'), ROSTER_TAKEN);
    expect(sql.roster.get('jason')?.owner_id).toBe('alice');
  });

  it('treats Ranger and ranger as one name: the other case is refused as taken, and stored lower-cased', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'Ranger');
    await expectCode(addRosterName(sql, 'bob', 'ranger'), ROSTER_TAKEN);
    await expectCode(addRosterName(sql, 'alice', 'RANGER'), ROSTER_TAKEN);
    expect([...sql.roster.keys()]).toEqual(['ranger']);
  });

  it('accepts max_agents at both ends (1 and 4) and refuses 0 and 5, adding nothing', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'clara', 4);
    await addRosterName(sql, 'alice', 'tommy', 1);
    expect(sql.roster.get('clara')?.max_agents).toBe(4);
    expect(sql.roster.get('tommy')?.max_agents).toBe(1);
    await expect(addRosterName(sql, 'alice', 'zack', 5)).rejects.toThrow('max_agents');
    await expect(addRosterName(sql, 'alice', 'billy', 0)).rejects.toThrow('max_agents');
    expect(sql.roster.has('zack')).toBe(false);
    expect(sql.roster.has('billy')).toBe(false);
  });

  it('refuses a name that is not a Minecraft name, before the database sees it', async () => {
    const sql = new FakeRoster();
    await expect(addRosterName(sql, 'alice', 'bad name!')).rejects.toThrow('name');
    expect(sql.log).toEqual([]);
  });
});

describe('roster remove', () => {
  it('refuses another owner, and keeps the row', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'kimberly');
    await expectCode(removeRosterName(sql, 'bob', 'kimberly'), ROSTER_NOT_LISTED);
    expect(sql.roster.has('kimberly')).toBe(true);
    expect(sql.roster.get('kimberly')?.owner_id).toBe('alice');
    expect(sql.log.some((text) => text.includes('owner_id = $2'))).toBe(true);
  });

  it('removes the owner’s own row', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'kimberly');
    await removeRosterName(sql, 'alice', 'kimberly');
    expect(sql.roster.has('kimberly')).toBe(false);
  });

  it('lists only the given owner’s names', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'jason');
    await addRosterName(sql, 'bob', 'clara');
    const rows = await listRoster(sql, 'alice');
    expect(rows.map((r) => r.player_name)).toEqual(['jason']);
  });
});

describe('roster seed', () => {
  it('adds each name once; a second run adds nothing and changes nothing', async () => {
    const sql = new FakeRoster();
    expect(await seedRoster(sql, 'alice', ['jason', 'clara'])).toBe(2);
    const before = new Map(sql.roster);
    expect(await seedRoster(sql, 'alice', ['jason', 'clara'])).toBe(0);
    expect(sql.roster).toEqual(before);
  });

  it('aborts on a mid-seed failure: no name from that run is left in the roster', async () => {
    const sql = new FakeRoster();
    sql.failInsert = 2;
    await expect(seedRoster(sql, 'alice', ['jason', 'clara', 'tommy'])).rejects.toThrow(
      'injected failure',
    );
    expect(sql.roster.size).toBe(0);
    expect(sql.log).toContain('ROLLBACK');
    expect(sql.log).not.toContain('COMMIT');
  });
});

describe('checkRosterStart', () => {
  it('refuses a name that is not on the roster', async () => {
    const sql = new FakeRoster();
    await expectCode(checkRosterStart(sql, 'alice', 'jason'), ROSTER_NOT_LISTED);
  });

  it('refuses a name that is on the roster for another owner', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'bob', 'jason');
    await expectCode(checkRosterStart(sql, 'alice', 'jason'), ROSTER_NOT_LISTED);
  });

  it('at max_agents 2: the 1st and the last allowed (2nd) start pass, the 3rd is refused', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'jason', 2);
    await checkRosterStart(sql, 'alice', 'jason');
    sql.players.push({ display_name: 'Jason', status: 'active' });
    await checkRosterStart(sql, 'alice', 'jason');
    sql.players.push({ display_name: 'Jason', status: 'paused' });
    await expectCode(checkRosterStart(sql, 'alice', 'jason'), ROSTER_LIMIT);
  });

  it('a retired agent does not count against max_agents', async () => {
    const sql = new FakeRoster();
    await addRosterName(sql, 'alice', 'jason', 1);
    sql.players.push({ display_name: 'Jason', status: 'retired' });
    await checkRosterStart(sql, 'alice', 'jason');
  });
});

describe('roster helpers', () => {
  it('reads the Minecraft names from sovereign.players', () => {
    const text =
      'sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n';
    expect(readRosterNames(text)).toEqual(['Jason']);
  });

  it('refuses a shard file with no sovereign.players list', () => {
    expect(() => readRosterNames('sovereign: {}\n')).toThrow('sovereign.players');
  });

  it('parses --max as a whole number from 1 to 4 only', () => {
    expect(parseMaxAgents('1')).toBe(1);
    expect(parseMaxAgents('4')).toBe(4);
    expect(() => parseMaxAgents('0')).toThrow();
    expect(() => parseMaxAgents('5')).toThrow();
    expect(() => parseMaxAgents('two')).toThrow();
  });
});
