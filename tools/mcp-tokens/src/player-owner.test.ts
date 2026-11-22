import { describe, expect, it } from 'vitest';
import type { Sql } from './owners.ts';
import { PLAYER_SET_OWNER_USAGE, parseSetOwner, setPlayerOwner } from './player-owner.ts';

interface Call {
  text: string;
  values?: unknown[] | undefined;
}

interface FakeOptions {
  /** The player row: undefined is an unknown player. */
  player?: { owner_id: string; life_id: string; display_name: string; status: string } | undefined;
  /** The target owner's cap: undefined is an unknown owner. */
  targetCap?: number | undefined;
  /** Live (non-retired) players the target owner holds. */
  targetUsed?: number;
  /** Rows the roster UPDATE changes (1 is the normal case). */
  rosterRows?: number;
  /** Rows the agents UPDATE changes (1 is the normal case). */
  agentRows?: number;
  /** The audit INSERT fails. */
  failAudit?: boolean;
}

const PLAYER = {
  owner_id: 'alice',
  life_id: 'ag_ranger_01',
  display_name: 'Ranger',
  status: 'active',
};

/** A fake session that records every statement in order; BEGIN, COMMIT and ROLLBACK are recorded too. */
function fakeSql(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const sql: Sql = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT owner_id, life_id, display_name, status FROM mcp_players')) {
        const player = 'player' in options ? options.player : PLAYER;
        return { rows: player === undefined ? [] : [player] };
      }
      if (text.startsWith('SELECT player_cap FROM mcp_owners')) {
        const cap =
          options.targetCap === undefined && !('targetCap' in options) ? 20 : options.targetCap;
        return { rows: cap === undefined ? [] : [{ player_cap: cap }] };
      }
      if (text.includes('count(*)::int AS n FROM mcp_players')) {
        return { rows: [{ n: options.targetUsed ?? 0 }] };
      }
      if (text.startsWith('UPDATE mcp_roster')) {
        const count = options.rosterRows ?? 1;
        return { rows: Array.from({ length: count }, () => ({ player_name: 'ranger' })) };
      }
      if (text.startsWith('UPDATE mcp_players')) {
        return { rows: [{ player_id: values?.[0] }] };
      }
      if (text.startsWith('UPDATE agents')) {
        const count = options.agentRows ?? 1;
        return { rows: Array.from({ length: count }, () => ({ agent_id: 'ag_ranger_01' })) };
      }
      if (text.startsWith('INSERT INTO register_audit') && options.failAudit) {
        throw new Error('audit write refused');
      }
      return { rows: [] };
    },
  };
  return { sql, calls };
}

const has = (calls: Call[], prefix: string) => calls.some((c) => c.text.startsWith(prefix));
const PLAYER_ID = 'ag-ranger-01';

describe('parseSetOwner', () => {
  it('reads a player id and an owner id', () => {
    expect(parseSetOwner(['ag-ranger-01', 'alice'])).toEqual({
      playerId: 'ag-ranger-01',
      owner: 'alice',
    });
  });

  it('refuses a missing word, extra words, a bad player id and a bad owner id', () => {
    expect(() => parseSetOwner(['ag-ranger-01'])).toThrow(PLAYER_SET_OWNER_USAGE);
    expect(() => parseSetOwner(['ag-ranger-01', 'alice', 'extra'])).toThrow(PLAYER_SET_OWNER_USAGE);
    expect(() => parseSetOwner(['ranger', 'alice'])).toThrow('player id must match');
    expect(() => parseSetOwner(['ag-ranger-01', 'Alice'])).toThrow();
  });
});

describe('setPlayerOwner', () => {
  it('moves the player, its roster row and its life in one transaction, then audits', async () => {
    const { sql, calls } = fakeSql();
    const lines = await setPlayerOwner(sql, PLAYER_ID, 'bob');
    const order = calls.map((c) => c.text.split(' ').slice(0, 3).join(' '));
    expect(order[0]).toBe('BEGIN');
    expect(order.indexOf('UPDATE mcp_roster SET')).toBeGreaterThan(-1);
    expect(has(calls, 'UPDATE mcp_players SET owner_id')).toBe(true);
    expect(has(calls, 'UPDATE mcp_roster SET owner_id')).toBe(true);
    expect(has(calls, 'UPDATE agents SET owner')).toBe(true);
    expect(has(calls, 'INSERT INTO register_audit')).toBe(true);
    expect(calls.at(-1)?.text).toBe('COMMIT');
    expect(lines).toEqual([`moved ${PLAYER_ID} from owner alice to owner bob`]);
  });

  it('passes the roster name in lower case and the life id to the agents row', async () => {
    const { sql, calls } = fakeSql();
    await setPlayerOwner(sql, PLAYER_ID, 'bob');
    const roster = calls.find((c) => c.text.startsWith('UPDATE mcp_roster'));
    expect(roster?.values).toEqual(['Ranger', 'bob', 'alice']);
    expect(roster?.text).toContain('player_name = lower($1)');
    const agent = calls.find((c) => c.text.startsWith('UPDATE agents'));
    expect(agent?.values).toEqual(['ag_ranger_01', 'bob', 'alice']);
  });

  it('writes the audit row with a hashed actor and a detail of owner ids only', async () => {
    const { sql, calls } = fakeSql();
    await setPlayerOwner(sql, PLAYER_ID, 'bob');
    const audit = calls.find((c) => c.text.startsWith('INSERT INTO register_audit'));
    expect(audit?.text).toContain("left(encode(sha256(convert_to($1, 'UTF8')), 'hex'), 16)");
    expect(audit?.values).toEqual([
      'operator',
      'player.set_owner',
      PLAYER_ID,
      'ok',
      false,
      'owner alice to bob',
    ]);
    expect(JSON.stringify(audit?.values)).not.toContain('Ranger');
  });

  it('refuses an unknown player before any write', async () => {
    const { sql, calls } = fakeSql({ player: undefined });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'bob')).rejects.toThrow(`no player ${PLAYER_ID}`);
    expect(has(calls, 'UPDATE')).toBe(false);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('refuses a retired player before any write', async () => {
    const { sql, calls } = fakeSql({ player: { ...PLAYER, status: 'retired' } });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'bob')).rejects.toThrow('is retired');
    expect(has(calls, 'UPDATE')).toBe(false);
  });

  it('refuses an unknown owner before any write', async () => {
    const { sql, calls } = fakeSql({ targetCap: undefined });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'nobody')).rejects.toThrow('no owner nobody');
    expect(has(calls, 'UPDATE')).toBe(false);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('refuses a move that would exceed the target cap, counting only live players', async () => {
    const full = fakeSql({ targetCap: 3, targetUsed: 3 });
    await expect(setPlayerOwner(full.sql, PLAYER_ID, 'bob')).rejects.toThrow(
      'owner bob is at the cap of 3 players',
    );
    expect(has(full.calls, 'UPDATE')).toBe(false);
    expect(full.calls.at(-1)?.text).toBe('ROLLBACK');

    const room = fakeSql({ targetCap: 3, targetUsed: 2 });
    await expect(setPlayerOwner(room.sql, PLAYER_ID, 'bob')).resolves.toHaveLength(1);
    const count = room.calls.find((c) => c.text.includes('count(*)::int AS n'));
    expect(count?.text).toContain("status <> 'retired'");
  });

  it('is a no-op success for a player already on that owner: nothing written, no audit row', async () => {
    const { sql, calls } = fakeSql();
    const lines = await setPlayerOwner(sql, PLAYER_ID, 'alice');
    expect(lines).toEqual([`player ${PLAYER_ID} is already on owner alice; nothing changed`]);
    expect(has(calls, 'UPDATE')).toBe(false);
    expect(has(calls, 'INSERT INTO register_audit')).toBe(false);
    expect(calls.at(-1)?.text).toBe('COMMIT');
  });

  it('rolls back when the roster does not list the name under the old owner', async () => {
    const { sql, calls } = fakeSql({ rosterRows: 0 });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'bob')).rejects.toThrow(
      'does not list this player',
    );
    expect(has(calls, 'UPDATE mcp_players')).toBe(false);
    expect(has(calls, 'UPDATE agents')).toBe(false);
    expect(has(calls, 'INSERT INTO register_audit')).toBe(false);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('rolls back when the life is not on the old owner', async () => {
    const { sql, calls } = fakeSql({ agentRows: 0 });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'bob')).rejects.toThrow('is not on owner alice');
    expect(has(calls, 'INSERT INTO register_audit')).toBe(false);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('rolls back all three moves when the audit write fails', async () => {
    const { sql, calls } = fakeSql({ failAudit: true });
    await expect(setPlayerOwner(sql, PLAYER_ID, 'bob')).rejects.toThrow('audit write refused');
    expect(has(calls, 'UPDATE agents')).toBe(true);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
    expect(calls.some((c) => c.text === 'COMMIT')).toBe(false);
  });
});
