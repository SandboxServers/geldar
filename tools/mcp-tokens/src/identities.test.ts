import { describe, expect, it } from 'vitest';
import { banIdentity, grantKinoAdmin, revokeKinoAdmin, unbanIdentity } from './identities.ts';
import type { Row, Sql } from './owners.ts';

const HASH = 'ab'.repeat(32);

/** A fake that answers the identity UPDATE with the given owner rows and the token UPDATE with n rows. */
function fake(identityRows: Row[], tokenRows: Row[] = []) {
  const log: { text: string; values: unknown[] | undefined }[] = [];
  const sql: Sql = {
    query: async (text, values) => {
      log.push({ text, values });
      if (text.startsWith('UPDATE mcp_identities')) return { rows: identityRows };
      if (text.startsWith('UPDATE mcp_tokens')) return { rows: tokenRows };
      return { rows: [] };
    },
  };
  return { sql, log };
}

describe('identity ban and unban', () => {
  it('bans the identity and revokes the owner live tokens in one transaction', async () => {
    const { sql, log } = fake([{ owner_id: 'reg-1' }], [{ token_id: 't1' }, { token_id: 't2' }]);
    expect(await banIdentity(sql, HASH)).toBe(2);
    const texts = log.map((entry) => entry.text.split('\n')[0]?.trim());
    expect(texts[0]).toBe('BEGIN');
    expect(log.at(-1)?.text).toBe('COMMIT');
    expect(log.find((e) => e.text.startsWith('UPDATE mcp_identities'))?.text).toContain(
      'banned_at = COALESCE(banned_at, now())',
    );
    const revoke = log.find((e) => e.text.startsWith('UPDATE mcp_tokens'));
    expect(revoke?.text).toContain('revoked_at = now()');
    expect(revoke?.text).toContain('WHERE revoked_at IS NULL');
    expect(revoke?.text).toContain('FROM mcp_players WHERE owner_id = $1');
    expect(revoke?.values).toEqual(['reg-1']);
  });

  it('rolls back and revokes nothing for an unknown identity', async () => {
    const { sql, log } = fake([]);
    await expect(banIdentity(sql, HASH)).rejects.toThrow('no identity');
    expect(log.some((e) => e.text.startsWith('UPDATE mcp_tokens'))).toBe(false);
    expect(log.at(-1)?.text).toBe('ROLLBACK');
  });

  it('refuses an id that is not 64 hex digits before the database sees it', async () => {
    const { sql, log } = fake([]);
    for (const bad of ['', 'AB'.repeat(32), 'ab', `${'ab'.repeat(31)}zz`]) {
      await expect(banIdentity(sql, bad)).rejects.toThrow('64 lower-case hex');
      await expect(unbanIdentity(sql, bad)).rejects.toThrow('64 lower-case hex');
    }
    expect(log).toEqual([]);
  });

  it('unban clears banned_at and does not touch tokens', async () => {
    const { sql, log } = fake([{ owner_id: 'reg-1' }]);
    await unbanIdentity(sql, HASH);
    expect(log).toHaveLength(1);
    expect(log[0]?.text).toContain('banned_at = NULL');
    await expect(unbanIdentity(fake([]).sql, HASH)).rejects.toThrow('no identity');
  });
});

describe('Kino admin grant and revoke (R42)', () => {
  function admins(known: boolean, deleted: boolean) {
    const log: { text: string; values: unknown[] | undefined }[] = [];
    const sql: Sql = {
      query: async (text, values) => {
        log.push({ text, values });
        if (text.startsWith('SELECT 1 FROM mcp_identities')) return { rows: known ? [{}] : [] };
        if (text.startsWith('DELETE FROM kino_admins')) return { rows: deleted ? [{}] : [] };
        return { rows: [] };
      },
    };
    return { sql, log };
  }

  it('grants only to a registered identity, once', async () => {
    const ok = admins(true, false);
    await grantKinoAdmin(ok.sql, HASH);
    expect(ok.log.at(-1)?.text).toContain('INSERT INTO kino_admins');
    expect(ok.log.at(-1)?.text).toContain('ON CONFLICT DO NOTHING');
    expect(ok.log.at(-1)?.values).toEqual([HASH]);
    const unknown = admins(false, false);
    await expect(grantKinoAdmin(unknown.sql, HASH)).rejects.toThrow('no identity');
    expect(unknown.log.some((e) => e.text.startsWith('INSERT'))).toBe(false);
  });

  it('revokes and says whether it was an admin; a bad id never reaches the database', async () => {
    expect(await revokeKinoAdmin(admins(true, true).sql, HASH)).toBe(true);
    expect(await revokeKinoAdmin(admins(true, false).sql, HASH)).toBe(false);
    const { sql, log } = admins(true, true);
    await expect(grantKinoAdmin(sql, 'AB')).rejects.toThrow('64 lower-case hex');
    await expect(revokeKinoAdmin(sql, 'AB')).rejects.toThrow('64 lower-case hex');
    expect(log).toEqual([]);
  });
});
