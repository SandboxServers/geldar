import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addOwner, parseCap, setOwnerCap } from './owners.ts';
import { FakeSql, player, SHARD, SHARD_YAML } from './players.fakes.ts';
import {
  addPlayer,
  GOALS_MAX_BYTES,
  IDENTITY_MAX_BYTES,
  parseSovereignShard,
  readSeedFiles,
  seedText,
  setPlayerModel,
  setPlayerStatus,
} from './players.ts';
import { ROSTER_LIMIT, ROSTER_NOT_LISTED } from './roster.ts';

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

  it('refuses a cap above 100 and a cap that is not a whole number', async () => {
    const sql = new FakeSql();
    await expect(addOwner(sql, 'jo', 101)).rejects.toThrow('0 to 100');
    expect(() => parseCap('101')).toThrow('0 to 100');
    expect(() => parseCap('2.5')).toThrow('0 to 100');
    expect(parseCap('100')).toBe(100);
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
