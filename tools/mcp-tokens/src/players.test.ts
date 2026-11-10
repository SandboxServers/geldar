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
  setPlayerStatus,
} from './players.ts';

/** An in-memory stand-in for the tables the commands touch; it answers only those statements. */
class FakeSql implements Sql {
  owners = new Map<string, number>();
  players: Array<{ player_id: string; owner_id: string; status: string }> = [];
  agents: string[] = [];
  budgets: string[] = [];
  revokedFor: string[] = [];
  log: string[] = [];

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
    if (text.includes('count(*)')) {
      const n = this.players.filter(
        (p) => p.owner_id === values[0] && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    if (text.startsWith('INSERT INTO agents')) {
      this.agents.push(String(values[0]));
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_players')) {
      this.players.push({
        player_id: String(values[0]),
        owner_id: String(values[1]),
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
      return { rows: [{ player_id: player.player_id }] };
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
    expect(sql.players).toEqual([{ player_id: 'ag-jo-01', owner_id: 'jo', status: 'active' }]);
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

describe('player status', () => {
  it('pauses, resumes and retires, and retiring revokes the player tokens', async () => {
    const sql = new FakeSql();
    await addOwner(sql, 'jo');
    await addPlayer(sql, player(1), SHARD);
    await setPlayerStatus(sql, 'ag-jo-01', 'pause');
    expect(sql.players[0]?.status).toBe('paused');
    await expect(setPlayerStatus(sql, 'ag-jo-01', 'pause')).rejects.toThrow('cannot pause');
    await setPlayerStatus(sql, 'ag-jo-01', 'resume');
    await setPlayerStatus(sql, 'ag-jo-01', 'retire');
    expect(sql.players[0]?.status).toBe('retired');
    expect(sql.revokedFor).toEqual(['ag-jo-01']);
  });
});
