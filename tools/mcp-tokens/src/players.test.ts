import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addOwner, parseCap, type Row, type Sql, setOwnerCap } from './owners.ts';
import {
  addPlayer,
  GOALS_MAX_BYTES,
  IDENTITY_MAX_BYTES,
  type NewPlayer,
  parseSovereignShard,
  readSeedFiles,
  type SovereignShard,
  seedText,
  setPlayerModel,
  setPlayerStatus,
} from './players.ts';
import { ROSTER_LIMIT, ROSTER_NOT_LISTED } from './roster.ts';

/** An in-memory stand-in for the tables the commands touch; it answers only those statements. */
class FakeSql implements Sql {
  owners = new Map<string, number>();
  /** The starting roster: the names `player()` uses, listed for owner jo with one agent each. */
  roster = new Map<string, { owner_id: string; max_agents: number }>(
    Array.from({ length: 30 }, (_, i) => [`player ${i + 1}`, { owner_id: 'jo', max_agents: 1 }]),
  );
  players: Array<{
    player_id: string;
    owner_id: string;
    life_id: string;
    display_name: string;
    status: string;
  }> = [];
  agents: string[] = [];
  budgets: string[] = [];
  revokedFor: string[] = [];
  log: string[] = [];
  /** The declared_model of each life, as the agents insert and the model update leave it. */
  declared = new Map<string, string>();

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.log.push(text);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
    if (text.startsWith('INSERT INTO mcp_owners')) {
      this.owners.set(String(values[0]), Number(values[1]));
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_owners')) {
      const id = String(values[0]);
      if (!this.owners.has(id)) return { rows: [] };
      this.owners.set(id, Number(values[1]));
      return { rows: [{ owner_id: id }] };
    }
    if (text.includes('FROM mcp_owners')) {
      const id = String(values[0]);
      return { rows: this.owners.has(id) ? [{ player_cap: this.owners.get(id) }] : [] };
    }
    if (text.includes('FOR UPDATE') && text.includes('FROM mcp_roster')) {
      const entry = this.roster.get(String(values[0]));
      return { rows: entry === undefined ? [] : [{ ...entry }] };
    }
    if (text.includes('count(*)') && text.includes('lower(display_name) = $1')) {
      // Mirrors the SQL: the roster count compares lower(display_name) to the lower-cased name.
      const wanted = String(values[0]);
      const n = this.players.filter(
        (p) => p.display_name.toLowerCase() === wanted && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    if (text.includes('count(*)')) {
      const n = this.players.filter(
        (p) => p.owner_id === values[0] && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    if (text.startsWith('INSERT INTO agents')) {
      this.agents.push(String(values[0]));
      this.declared.set(String(values[0]), String(values[6]));
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_players')) {
      this.players.push({
        player_id: String(values[0]),
        owner_id: String(values[1]),
        life_id: String(values[2]),
        display_name: String(values[3]),
        status: 'active',
      });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_budget')) {
      this.budgets.push(String(values[0]));
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_players')) {
      const player = this.players.find((p) => p.player_id === values[0]);
      const allowed = values[2] as string[];
      if (player === undefined || !allowed.includes(player.status)) return { rows: [] };
      player.status = String(values[1]);
      return { rows: [{ player_id: player.player_id, life_id: player.life_id }] };
    }
    if (text.startsWith('UPDATE agents')) {
      // The retired refusal lives in the SQL text: without that clause the fake matches a retired
      // player too, so removing the clause from players.ts fails the retired test.
      const refusesRetired = text.includes("status <> 'retired'");
      const player = this.players.find(
        (p) => p.player_id === values[0] && (!refusesRetired || p.status !== 'retired'),
      );
      if (player === undefined) return { rows: [] };
      this.declared.set(player.life_id, String(values[1]));
      return { rows: [{ agent_id: player.life_id }] };
    }
    if (text.startsWith('UPDATE mcp_tokens')) {
      this.revokedFor.push(String(values[0]));
      return { rows: [] };
    }
    throw new Error(`the fake has no answer for: ${text}`);
  }
}

const SHARD_YAML = `shard: phase0
identity_mode: watched
sovereign:
  allowed: true
  harnesses:
    claude: { enabled: true }
    codex: { enabled: false }
  budget:
    credits_per_real_hour: 30
    cap_credits: 240
`;

const SHARD: SovereignShard = parseSovereignShard(SHARD_YAML);

const SHEET_SHARD = parseSovereignShard(
  SHARD_YAML.replace('shard: phase0\n', 'shard: phase0\ncharacter:\n  mode: sheet\n'),
);

/** Canonical JSON (sorted keys, no whitespace) written out by hand, so the hash test does not reuse psyche. */
const STANDARD_CANON =
  '{"alignment":{"good":3,"law":3},"attributes":{"aggression":3,"cleverness":3,"common_sense":3,"curiosity":3},"op_modes":{"builder":3,"crafter":3,"explorer":3,"farmer":3,"miner":3,"nitwit":3,"warrior":3},"version":1}';
const GIVEN_CANON =
  '{"alignment":{"good":2,"law":4},"attributes":{"aggression":1,"cleverness":4,"common_sense":2,"curiosity":5},"op_modes":{"builder":3,"crafter":4,"explorer":5,"farmer":1,"miner":2,"nitwit":2,"warrior":1},"version":1}';
/** A sheet whose keys are not in canonical order. */
const GIVEN = {
  version: 1,
  attributes: { curiosity: 5, common_sense: 2, cleverness: 4, aggression: 1 },
  alignment: { good: 2, law: 4 },
  op_modes: { warrior: 1, nitwit: 2, miner: 2, farmer: 1, explorer: 5, crafter: 4, builder: 3 },
};

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A fake that also records the roster sheet statements: the agents sheet columns, events and adoptions. */
class SheetSql extends FakeSql {
  events: unknown[][] = [];
  adoptions: unknown[][] = [];
  sheets = new Map<string, { sheet: unknown; hash: unknown }>();
  failAdoption = false;

  constructor() {
    super();
    this.owners.set('jo', 3);
  }

  override async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    if (text.startsWith('INSERT INTO agents')) {
      this.sheets.set(String(values[0]), { sheet: values[7], hash: values[8] });
    }
    if (text.startsWith('INSERT INTO events')) {
      this.log.push(text);
      this.events.push(values);
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO character_sheet_adoptions')) {
      this.log.push(text);
      if (this.failAdoption) throw new Error('adoption insert refused');
      this.adoptions.push(values);
      return { rows: [] };
    }
    return super.query(text, values);
  }
}

describe('character.mode in the shard', () => {
  it('reads sheet; an omitted mode, or mode off, is off; any other mode throws', () => {
    expect(SHEET_SHARD.characterMode).toBe('sheet');
    expect(SHARD.characterMode).toBe('off');
    expect(parseSovereignShard(`${SHARD_YAML}character:\n  mode: off\n`).characterMode).toBe('off');
    expect(parseSovereignShard(`${SHARD_YAML}character: {}\n`).characterMode).toBe('off');
    expect(() => parseSovereignShard(`${SHARD_YAML}character:\n  mode: sometimes\n`)).toThrow(
      'character.mode must be off or sheet',
    );
  });
});

describe('roster creation in a sheet-mode shard', () => {
  it('writes the standard sheet, its hash and the adoption when no sheet is given', async () => {
    const sql = new SheetSql();
    const p = player(1);
    await addPlayer(sql, p, SHEET_SHARD);
    const stored = sql.sheets.get(p.life);
    expect(JSON.parse(String(stored?.sheet))).toEqual(JSON.parse(STANDARD_CANON));
    expect(stored?.hash).toBe(sha(STANDARD_CANON));
    expect(sql.adoptions).toEqual([
      [`roster:sheet_adopted:${p.life}`, p.life, sha(STANDARD_CANON), stored?.sheet],
    ]);
    expect(sql.events).toHaveLength(1);
  });

  it('records the adoption in the same transaction, between BEGIN and COMMIT', async () => {
    const sql = new SheetSql();
    await addPlayer(sql, player(1), SHEET_SHARD);
    const at = (prefix: string): number => sql.log.findIndex((t) => t.startsWith(prefix));
    const adoption = at('INSERT INTO character_sheet_adoptions');
    expect(adoption).toBeGreaterThan(-1);
    expect(sql.log.indexOf('BEGIN')).toBeLessThan(at('INSERT INTO agents'));
    expect(at('INSERT INTO agents')).toBeLessThan(at('INSERT INTO events'));
    expect(at('INSERT INTO events')).toBeLessThan(adoption);
    expect(adoption).toBeLessThan(sql.log.indexOf('COMMIT'));
  });

  it('adopts a given sheet as given, and its hash is that of the canonical JSON', async () => {
    const sql = new SheetSql();
    const p = { ...player(2), characterSheet: GIVEN };
    await addPlayer(sql, p, SHEET_SHARD);
    expect(sql.sheets.get(p.life)?.hash).toBe(sha(GIVEN_CANON));
    expect(JSON.parse(String(sql.sheets.get(p.life)?.sheet))).toEqual(GIVEN);
  });

  it('refuses a malformed sheet before any write, naming the field and not its value', async () => {
    const sql = new SheetSql();
    const bad = { ...GIVEN, attributes: { ...GIVEN.attributes, curiosity: 9 } };
    const error = await addPlayer(sql, { ...player(3), characterSheet: bad }, SHEET_SHARD).catch(
      (e: unknown) => e,
    );
    expect(String(error)).toContain('attributes.curiosity');
    expect(String(error)).not.toContain('9');
    expect(sql.log).toEqual([]);
    expect(sql.agents).toEqual([]);
  });

  it('refuses a sheet in an off shard and writes nothing', async () => {
    const sql = new SheetSql();
    await expect(addPlayer(sql, { ...player(4), characterSheet: GIVEN }, SHARD)).rejects.toThrow(
      'the shard has character mode off',
    );
    expect(sql.log).toEqual([]);
  });

  it('writes no sheet and no adoption in an off shard', async () => {
    const sql = new SheetSql();
    const p = player(5);
    await addPlayer(sql, p, SHARD);
    expect(sql.sheets.get(p.life)).toEqual({ sheet: null, hash: null });
    expect(sql.adoptions).toEqual([]);
    expect(sql.events).toEqual([]);
  });

  it('rolls the whole add back when the adoption insert fails', async () => {
    const sql = new SheetSql();
    sql.failAdoption = true;
    await expect(addPlayer(sql, player(6), SHEET_SHARD)).rejects.toThrow('adoption insert refused');
    expect(sql.log).toContain('ROLLBACK');
    expect(sql.log).not.toContain('COMMIT');
    expect(sql.players).toEqual([]);
    expect(sql.budgets).toEqual([]);
  });
});

function player(n: number, owner = 'jo'): NewPlayer {
  return {
    playerId: `ag-jo-${String(n).padStart(2, '0')}`,
    owner,
    life: `ag_jo_${String(n).padStart(2, '0')}`,
    name: `Player ${n}`,
    harness: 'claude',
  };
}

describe('owner cap', () => {
  it('lets an owner hold 20 players and refuses the 21st', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo', 20);
    for (let n = 1; n <= 20; n += 1) await addPlayer(sql, player(n), SHARD);
    expect(sql.players).toHaveLength(20);
    await expect(addPlayer(sql, player(21), SHARD)).rejects.toThrow('cap of 20');
    expect(sql.players).toHaveLength(20);
    expect(sql.agents).toHaveLength(20);
  });

  it('rolls the transaction back when the cap refuses, so no half-made player remains', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo', 1);
    await addPlayer(sql, player(1), SHARD);
    await expect(addPlayer(sql, player(2), SHARD)).rejects.toThrow();
    expect(sql.log).toContain('ROLLBACK');
    expect(sql.agents).toEqual(['ag_jo_01']);
  });

  it('refuses a cap above 50 and a cap that is not a whole number', async () => {
    const sql = new FakeSql();
    await expect(addOwner(sql, 'jo', 51)).rejects.toThrow('0 to 50');
    expect(() => parseCap('51')).toThrow('0 to 50');
    expect(() => parseCap('2.5')).toThrow('0 to 50');
    expect(parseCap('50')).toBe(50);
    await addOwner(sql, 'jo');
    expect(sql.owners.get('jo')).toBe(3);
    await setOwnerCap(sql, 'jo', 50);
    expect(sql.owners.get('jo')).toBe(50);
    await expect(setOwnerCap(sql, 'nobody', 5)).rejects.toThrow('no owner nobody');
  });

  it('refuses an unknown owner', async () => {
    await expect(addPlayer(new FakeSql(), player(1, 'nobody'), SHARD)).rejects.toThrow(
      'no owner nobody',
    );
  });
});

describe('player add checks', () => {
  it('refuses a harness the shard has not enabled', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await expect(addPlayer(sql, { ...player(1), harness: 'codex' }, SHARD)).rejects.toThrow(
      'not enabled',
    );
    expect(sql.agents).toEqual([]);
  });

  it('refuses a shard that does not allow sovereign players', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    const closed = { ...SHARD, allowed: false };
    await expect(addPlayer(sql, player(1), closed)).rejects.toThrow('does not allow');
  });

  it('writes the agents row as a sovereign life and the first budget at the cap', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await addPlayer(sql, player(1), SHARD);
    expect(sql.agents).toEqual(['ag_jo_01']);
    expect(sql.players).toEqual([
      {
        player_id: 'ag-jo-01',
        owner_id: 'jo',
        life_id: 'ag_jo_01',
        display_name: 'Player 1',
        status: 'active',
      },
    ]);
    expect(sql.budgets).toEqual(['ag_jo_01']);
  });

  it('refuses a shard config without the watched identity mode', () => {
    expect(() => parseSovereignShard(SHARD_YAML.replace('watched', 'unwatched'))).toThrow(
      'identity_mode: watched',
    );
  });
});

describe('seed checks', () => {
  const long = (bytes: number): string => 'a'.repeat(bytes);

  it('accepts an identity up to 8192 bytes and refuses one byte more', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    const seed = (identity: string) => ({ ...player(1), seed: { identity, goals: 'Keep warm.' } });
    await addPlayer(sql, seed(long(IDENTITY_MAX_BYTES)), SHARD);
    await expect(
      addPlayer(
        sql,
        { ...seed(long(IDENTITY_MAX_BYTES + 1)), playerId: 'ag-jo-02', life: 'ag_jo_02' },
        SHARD,
      ),
    ).rejects.toThrow('8192 bytes');
  });

  it('refuses goals over 4096 bytes', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await expect(
      addPlayer(
        sql,
        { ...player(1), seed: { identity: 'Curious.', goals: long(GOALS_MAX_BYTES + 1) } },
        SHARD,
      ),
    ).rejects.toThrow('4096 bytes');
  });

  it('allows multi-line markdown and a single line longer than 600 characters', () => {
    const identity = `# Adam\n\n${long(700)}\n\n- curious\n- patient`;
    expect(seedText({ identity, goals: 'Find water.' })).toBe(
      `${identity}\n\n## Goals\n\nFind water.`,
    );
    expect(seedText({ identity: 'Quiet.', goals: '  ' })).toBe('Quiet.');
  });

  describe('readSeedFiles', () => {
    let dir = '';
    afterEach(async () => {
      if (dir !== '') await rm(dir, { recursive: true, force: true });
      dir = '';
    });

    it('reads a markdown identity and optional goals files', async () => {
      dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-seed-'));
      const identity = join(dir, 'identity.md');
      const goals = join(dir, 'goals.md');
      await writeFile(identity, '# Adam\n\nCurious.\n');
      await writeFile(goals, '- Build a hut.\n');
      expect(await readSeedFiles(identity, goals)).toEqual({
        identity: '# Adam\n\nCurious.\n',
        goals: '- Build a hut.\n',
      });
      expect(await readSeedFiles(identity)).toEqual({
        identity: '# Adam\n\nCurious.\n',
        goals: '',
      });
    });

    it('refuses an oversize file without echoing its contents', async () => {
      dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-seed-'));
      const big = join(dir, 'big.md');
      await writeFile(big, `SECRET-LOOKING-TEXT${'a'.repeat(IDENTITY_MAX_BYTES)}`);
      const error = await readSeedFiles(big).catch((e: unknown) => e);
      expect(String(error)).toContain('8192 bytes');
      expect(String(error)).not.toContain('SECRET-LOOKING-TEXT');
    });
  });
});

describe('sovereign start checks the roster (sql 0024)', () => {
  it('refuses a name that is not on the roster, and writes no agent row', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await expect(addPlayer(sql, { ...player(1), name: 'Stranger' }, SHARD)).rejects.toMatchObject({
      code: ROSTER_NOT_LISTED,
    });
    expect(sql.agents).toEqual([]);
    expect(sql.log).toContain('ROLLBACK');
  });

  it('refuses a name that another owner holds', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    sql.roster.set('player 1', { owner_id: 'bob', max_agents: 1 });
    await expect(addPlayer(sql, player(1), SHARD)).rejects.toMatchObject({
      code: ROSTER_NOT_LISTED,
    });
    expect(sql.agents).toEqual([]);
  });

  it('at max_agents 2: the 1st and the last allowed (2nd) start pass, the 3rd is refused', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    sql.roster.set('player 1', { owner_id: 'jo', max_agents: 2 });
    await addPlayer(sql, player(1), SHARD);
    await addPlayer(sql, { ...player(2), name: 'Player 1' }, SHARD);
    await expect(addPlayer(sql, { ...player(3), name: 'Player 1' }, SHARD)).rejects.toMatchObject({
      code: ROSTER_LIMIT,
    });
    expect(sql.agents).toHaveLength(2);
  });
});

describe('player model (GX-01c)', () => {
  it('writes the declared model given with --model, and the placeholder when none is given', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, { ...player(1), model: 'claude-sonnet-5.5' }, SHARD);
    expect(sql.declared.get('ag_jo_01')).toBe('claude-sonnet-5.5');
    await addPlayer(sql, player(2), SHARD);
    expect(sql.declared.get('ag_jo_02')).toBe('self-reported');
  });

  it('refuses a model the contract pattern does not take, before any write', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await expect(addPlayer(sql, { ...player(1), model: 'bad model!' }, SHARD)).rejects.toThrow(
      /model/,
    );
    expect(sql.agents).toHaveLength(0);
    expect(sql.log).toHaveLength(0);
  });

  it('sets the declared model of the life of a live player', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, player(1), SHARD);
    await setPlayerModel(sql, 'ag-jo-01', 'claude-sonnet-5.5');
    expect(sql.declared.get('ag_jo_01')).toBe('claude-sonnet-5.5');
  });

  it('refuses a retired player and leaves its model alone', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, player(1), SHARD);
    await setPlayerStatus(sql, 'ag-jo-01', 'retire');
    await expect(setPlayerModel(sql, 'ag-jo-01', 'claude-sonnet-5.5')).rejects.toThrow(
      /no live player/,
    );
    expect(sql.declared.get('ag_jo_01')).toBe('self-reported');
  });

  it('refuses an unknown player', async () => {
    const sql = new FakeSql();
    await expect(setPlayerModel(sql, 'ag-nobody-01', 'claude-sonnet-5.5')).rejects.toThrow(
      /no live player/,
    );
  });

  it('refuses a model with a space in it and writes nothing', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, player(1), SHARD);
    await expect(setPlayerModel(sql, 'ag-jo-01', 'two words')).rejects.toThrow(/model/);
    expect(sql.declared.get('ag_jo_01')).toBe('self-reported');
  });
});

describe('player status', () => {
  it('pauses, resumes and retires, and retiring revokes the player tokens', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await addPlayer(sql, player(1), SHARD);
    await setPlayerStatus(sql, 'ag-jo-01', 'pause');
    expect(sql.players[0]?.status).toBe('paused');
    await expect(setPlayerStatus(sql, 'ag-jo-01', 'pause')).rejects.toThrow('cannot pause');
    await setPlayerStatus(sql, 'ag-jo-01', 'resume');
    expect(await setPlayerStatus(sql, 'ag-jo-01', 'retire')).toBe('ag_jo_01');
    expect(sql.players[0]?.status).toBe('retired');
    expect(sql.revokedFor).toEqual(['ag-jo-01']);
  });
});
