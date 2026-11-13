import { describe, expect, it } from 'vitest';
import {
  pgAdminFlags,
  pgAudit,
  pgDisplayNames,
  pgLogs,
  pgRoster,
  pgStartCounts,
  type SqlQuery,
} from './pg-ports.ts';

interface Recorded {
  text: string;
  params: unknown[];
}

// A query that records each statement and answers with fixed rows, or fails.
function recorder(rows: Record<string, unknown>[] = [], fail?: Error) {
  const seen: Recorded[] = [];
  const query: SqlQuery = async (text, params) => {
    seen.push({ text, params });
    if (fail) throw fail;
    return { rows };
  };
  return { query, seen };
}

const SINCE = new Date('2026-11-13T11:00:00.000Z');

describe('roster and admin flag', () => {
  it('looks the owner up by the lower-cased name', async () => {
    const { query, seen } = recorder([{ owner_id: 'owner-a' }]);
    await expect(pgRoster(query).ownerOfPlayer('Ranger')).resolves.toBe('owner-a');
    expect(seen[0]?.params).toEqual(['ranger']);
  });

  it('a name with no roster row has no owner, and a failed read rejects (the supervisor fails closed)', async () => {
    await expect(pgRoster(recorder([]).query).ownerOfPlayer('ranger')).resolves.toBeNull();
    const failing = recorder([], new Error('connection lost'));
    await expect(pgRoster(failing.query).ownerOfPlayer('ranger')).rejects.toThrow(
      'connection lost',
    );
  });

  it('the admin flag comes from supervisor_is_admin with the owner id', async () => {
    const { query, seen } = recorder([{ admin: true }]);
    await expect(pgAdminFlags(query).isAdmin('owner-a')).resolves.toBe(true);
    expect(seen[0]?.text).toContain('supervisor_is_admin($1)');
    expect(seen[0]?.params).toEqual(['owner-a']);
  });

  it('an unknown owner, a false flag and a failed read are all false (decision 0170)', async () => {
    await expect(pgAdminFlags(recorder([{ admin: false }]).query).isAdmin('x')).resolves.toBe(
      false,
    );
    await expect(pgAdminFlags(recorder([]).query).isAdmin('x')).resolves.toBe(false);
    await expect(pgAdminFlags(recorder([], new Error('boom')).query).isAdmin('x')).resolves.toBe(
      false,
    );
  });

  it('the admin read never reads a column of mcp_owners', async () => {
    const { query, seen } = recorder([{ admin: false }]);
    await pgAdminFlags(query).isAdmin('owner-a');
    expect(seen[0]?.text).not.toMatch(/mcp_owners|is_admin\s+FROM/);
  });
});

describe('start counts and audit', () => {
  it('an insert stores the lower-cased name, the op and the time', async () => {
    const { query, seen } = recorder();
    await pgStartCounts(query).insert({
      ownerId: 'owner-a',
      playerName: 'Ranger',
      op: 'start',
      at: SINCE,
    });
    expect(seen[0]?.text).toMatch(/^INSERT INTO body_ops/);
    expect(seen[0]?.params).toEqual(['owner-a', 'ranger', 'start', SINCE]);
  });

  it('counts come back as numbers, and an unreadable count throws rather than guessing', async () => {
    await expect(
      pgStartCounts(recorder([{ n: 3 }]).query).countPlayerSince('Ranger', SINCE),
    ).resolves.toBe(3);
    await expect(
      pgStartCounts(recorder([{ n: 'x' }]).query).countOwnerSince('o', SINCE),
    ).rejects.toThrow();
  });

  it('an audit row is an INSERT into register_audit with the six columns', async () => {
    const { query, seen } = recorder();
    await pgAudit(query).append({
      actor: 'abc',
      action: 'body_start',
      target: 'ranger',
      outcome: 'ok',
      admin: false,
      detail: '',
    });
    expect(seen[0]?.text).toMatch(
      /^INSERT INTO register_audit \(actor, action, target, outcome, admin, detail\)/,
    );
    expect(seen[0]?.params).toEqual(['abc', 'body_start', 'ranger', 'ok', false, '']);
  });

  it('a failed audit insert rejects, so the supervisor can decide what the caller sees', async () => {
    const failing = recorder([], new Error('disk full'));
    await expect(
      pgAudit(failing.query).append({
        actor: 'a',
        action: 'b',
        target: 'c',
        outcome: 'ok',
        admin: false,
        detail: '',
      }),
    ).rejects.toThrow('disk full');
  });
});

describe('log events', () => {
  it('the read is bounded to the current roster record: same owner, at or after its creation', async () => {
    const { query, seen } = recorder([]);
    await pgLogs(query).recent('Ranger', 5);
    expect(seen[0]?.text).toContain('b.at >= r.created_at');
    expect(seen[0]?.text).toContain('r.owner_id = b.owner_id');
    expect(seen[0]?.params).toEqual(['ranger', 5]);
  });

  it('events come back oldest first, with fixed codes', async () => {
    const t1 = new Date('2026-11-13T11:10:00.000Z');
    const t2 = new Date('2026-11-13T11:20:00.000Z');
    // The query orders newest first; the adapter reverses it.
    const { query } = recorder([
      { op: 'restart', at: t2 },
      { op: 'start', at: t1 },
    ]);
    await expect(pgLogs(query).recent('Ranger', 5)).resolves.toEqual([
      { at: t1, code: 'started' },
      { at: t2, code: 'restarted' },
    ]);
  });
});

describe('the SQL the adapters send', () => {
  it('names only the granted relations, and never UPDATE, DELETE or TRUNCATE', async () => {
    const all = recorder([{ owner_id: 'o', admin: true, n: 1, op: 'start', at: SINCE }]);
    const adapters = [
      () => pgRoster(all.query).ownerOfPlayer('Ranger'),
      () => pgAdminFlags(all.query).isAdmin('o'),
      () =>
        pgStartCounts(all.query).insert({ ownerId: 'o', playerName: 'p', op: 'start', at: SINCE }),
      () => pgStartCounts(all.query).countPlayerSince('p', SINCE),
      () => pgStartCounts(all.query).countOwnerSince('o', SINCE),
      () =>
        pgAudit(all.query).append({
          actor: 'a',
          action: 'b',
          target: 'c',
          outcome: 'ok',
          admin: false,
          detail: '',
        }),
      () => pgLogs(all.query).recent('p', 3),
    ];
    for (const run of adapters) await run();
    const allowed = new Set(['mcp_roster', 'body_ops', 'register_audit']);
    const tables = all.seen.flatMap((s) =>
      [...s.text.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]),
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(allowed.has(table ?? '')).toBe(true);
    for (const s of all.seen) expect(s.text).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
  });
});

describe('exact-case login name', () => {
  it('reads the name through the definer function, keyed by owner and lower-cased name', async () => {
    const { query, seen } = recorder([{ name: 'Ranger' }]);
    await expect(pgDisplayNames(query).displayName('owner-a', 'Ranger')).resolves.toBe('Ranger');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toContain('supervisor_player_display_name(');
    expect(seen[0]?.text).not.toContain('mcp_players');
    expect(seen[0]?.params).toEqual(['owner-a', 'ranger']);
  });

  it('no single spelling is null, and a failed read throws rather than falling back', async () => {
    await expect(
      pgDisplayNames(recorder([{ name: null }]).query).displayName('owner-a', 'ranger'),
    ).resolves.toBeNull();
    await expect(
      pgDisplayNames(recorder([]).query).displayName('owner-a', 'ranger'),
    ).resolves.toBeNull();
    const failing = recorder([], new Error('permission denied for function'));
    await expect(pgDisplayNames(failing.query).displayName('owner-a', 'ranger')).rejects.toThrow(
      'permission denied',
    );
  });
});
