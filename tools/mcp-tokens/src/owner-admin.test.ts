import { describe, expect, it } from 'vitest';
import { OWNER_ADMIN_USAGE, parseOwnerAdmin, runOwnerAdmin, setOwnerAdmin } from './owner-admin.ts';
import type { Sql } from './owners.ts';

interface Call {
  text: string;
  values?: unknown[] | undefined;
}

interface FakeOptions {
  /** How many rows the owner UPDATE finds: 0 is an unknown owner. */
  updateRows?: number;
  /** The audit INSERT fails. */
  failAudit?: boolean;
  /** The owner ids the flag SELECT returns. */
  flagged?: string[];
}

/** A fake session that records every statement in order; BEGIN, COMMIT and ROLLBACK are recorded too. */
function fakeSql(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const sql: Sql = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.startsWith('UPDATE mcp_owners')) {
        const count = options.updateRows ?? 1;
        return { rows: Array.from({ length: count }, () => ({ owner_id: 'alice' })) };
      }
      if (text.startsWith('INSERT INTO register_audit') && options.failAudit) {
        throw new Error('audit write refused');
      }
      if (text.startsWith('SELECT owner_id FROM mcp_owners')) {
        return { rows: (options.flagged ?? []).map((owner_id) => ({ owner_id })) };
      }
      return { rows: [] };
    },
  };
  return { sql, calls };
}

const audits = (calls: Call[]) =>
  calls.filter((c) => c.text.startsWith('INSERT INTO register_audit'));
const texts = (calls: Call[]) => calls.map((c) => c.text);

describe('parseOwnerAdmin', () => {
  it('reads set, unset and list', () => {
    expect(parseOwnerAdmin(['set', 'alice'])).toEqual({ verb: 'set', id: 'alice' });
    expect(parseOwnerAdmin(['unset', 'alice'])).toEqual({ verb: 'unset', id: 'alice' });
    expect(parseOwnerAdmin(['list'])).toEqual({ verb: 'list' });
  });

  it('refuses a missing id, extra words, a bad owner id and an unknown verb', () => {
    expect(() => parseOwnerAdmin(['set'])).toThrow(OWNER_ADMIN_USAGE);
    expect(() => parseOwnerAdmin(['unset', 'alice', 'extra'])).toThrow(OWNER_ADMIN_USAGE);
    expect(() => parseOwnerAdmin(['list', 'alice'])).toThrow(OWNER_ADMIN_USAGE);
    expect(() => parseOwnerAdmin(['grant', 'alice'])).toThrow(OWNER_ADMIN_USAGE);
    expect(() => parseOwnerAdmin(['set', 'Bad Id'])).toThrow('owner id must be');
  });
});

describe('setOwnerAdmin', () => {
  it('sets the flag and writes exactly one operator audit row inside one transaction', async () => {
    const { sql, calls } = fakeSql();
    await setOwnerAdmin(sql, 'alice', true);
    expect(texts(calls)[0]).toBe('BEGIN');
    expect(texts(calls).at(-1)).toBe('COMMIT');
    expect(calls[1]?.text).toContain('UPDATE mcp_owners SET is_admin = $2');
    expect(calls[1]?.values).toEqual(['alice', true]);
    const rows = audits(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values).toEqual(['operator', 'admin_set', 'alice', 'ok', false]);
  });

  it('unset writes admin_unset and clears the flag', async () => {
    const { sql, calls } = fakeSql();
    await setOwnerAdmin(sql, 'alice', false);
    expect(calls[1]?.values).toEqual(['alice', false]);
    expect(audits(calls)).toHaveLength(1);
    expect(audits(calls)[0]?.values?.[1]).toBe('admin_unset');
  });

  it('refuses an unknown owner: no audit row, and the transaction rolls back', async () => {
    const { sql, calls } = fakeSql({ updateRows: 0 });
    await expect(setOwnerAdmin(sql, 'ghost', true)).rejects.toThrow('no owner ghost');
    expect(audits(calls)).toHaveLength(0);
    expect(texts(calls)).toContain('ROLLBACK');
    expect(texts(calls)).not.toContain('COMMIT');
  });

  it('a failed audit write fails the set: the flag change is rolled back, never committed', async () => {
    const { sql, calls } = fakeSql({ failAudit: true });
    await expect(setOwnerAdmin(sql, 'alice', true)).rejects.toThrow('audit write refused');
    expect(texts(calls)).toContain(
      'UPDATE mcp_owners SET is_admin = $2 WHERE owner_id = $1 RETURNING owner_id',
    );
    expect(texts(calls)).toContain('ROLLBACK');
    expect(texts(calls)).not.toContain('COMMIT');
  });

  it('a set for a bad owner id is refused before the database sees it', async () => {
    const { sql, calls } = fakeSql();
    await expect(setOwnerAdmin(sql, 'Not Valid', true)).rejects.toThrow('owner id must be');
    expect(calls).toHaveLength(0);
  });
});

describe('runOwnerAdmin', () => {
  it('prints the set line and the list, one owner per line in order', async () => {
    const { sql } = fakeSql();
    expect(await runOwnerAdmin(sql, { verb: 'set', id: 'alice' })).toEqual([
      'owner alice admin set',
    ]);
    const listed = fakeSql({ flagged: ['alice', 'bob'] });
    expect(await runOwnerAdmin(listed.sql, { verb: 'list' })).toEqual(['admin alice', 'admin bob']);
  });

  it('says so when no owner is flagged, and list writes no audit row', async () => {
    const { sql, calls } = fakeSql({ flagged: [] });
    expect(await runOwnerAdmin(sql, { verb: 'list' })).toEqual(['no admin owners']);
    expect(audits(calls)).toHaveLength(0);
  });
});
