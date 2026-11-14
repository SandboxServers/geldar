import { describe, expect, it } from 'vitest';
import { KeyDbRefusal, OwnerKeyPgStore, type QueryClient } from '../src/owner-keys-pg.ts';

/** A fake client: each query is answered by the script, and every call is recorded. */
function fakeClient(answer: (text: string, values: unknown[]) => Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const client: QueryClient = {
    async query(text, values = []) {
      calls.push({ text, values });
      return { rows: answer(text, values) };
    },
  };
  return { client, calls };
}

function sqlState(code: string): Error {
  return Object.assign(new Error(`sqlstate ${code}`), { code });
}

const PRESENTER = Buffer.alloc(32, 1);
const KEY_HASH = Buffer.alloc(32, 2);

describe('OwnerKeyPgStore: resolve and list', () => {
  it('resolve maps the definer row to the owner and scopes', async () => {
    const { client, calls } = fakeClient(() => [{ owner_id: 'o-1', scopes: ['read', 'manage'] }]);
    const store = new OwnerKeyPgStore(client);
    expect(await store.resolve(PRESENTER)).toEqual({ ownerId: 'o-1', scopes: ['read', 'manage'] });
    expect(calls[0]?.text).toContain('register_owner_key_resolve($1)');
    expect(calls[0]?.values).toEqual([PRESENTER]);
  });

  it('resolve is null when the definer returns no row', async () => {
    const { client } = fakeClient(() => []);
    expect(await new OwnerKeyPgStore(client).resolve(PRESENTER)).toBeNull();
  });

  it('list is null (refused), never an empty successful list, when the definer returns no rows', async () => {
    const { client } = fakeClient(() => []);
    expect(await new OwnerKeyPgStore(client).list(PRESENTER)).toBeNull();
  });

  it('list maps each row to a key with no value and no hash', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const expires = new Date('2026-04-01T00:00:00Z');
    const { client } = fakeClient(() => [
      {
        key_id: 'k-1',
        scopes: ['read'],
        created_at: created,
        expires_at: expires,
        revoked_at: null,
        last_used_at: null,
      },
    ]);
    const rows = await new OwnerKeyPgStore(client).list(PRESENTER);
    expect(rows).toEqual([
      {
        keyId: 'k-1',
        scopes: ['read'],
        createdAt: created,
        expiresAt: expires,
        revokedAt: null,
        lastUsedAt: null,
      },
    ]);
  });
});

describe('OwnerKeyPgStore: mint', () => {
  it('returns the expiry when the definer writes the row', async () => {
    const expires = new Date('2026-04-01T00:00:00Z');
    const { client, calls } = fakeClient(() => [{ expires_at: expires }]);
    const at = await new OwnerKeyPgStore(client).mint(PRESENTER, 'k-2', KEY_HASH, ['read']);
    expect(at).toEqual(expires);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('register_mint_owner_key($1, $2, $3, $4)');
    expect(calls[0]?.values).toEqual([PRESENTER, 'k-2', KEY_HASH, ['read']]);
  });

  it('returns null when the definer refuses the presenter', async () => {
    const { client } = fakeClient(() => [{ expires_at: null }]);
    expect(await new OwnerKeyPgStore(client).mint(PRESENTER, 'k-3', KEY_HASH, ['read'])).toBeNull();
  });

  it('maps SQLSTATE 42501 (scope escalation) to scope_missing and rethrows nothing else', async () => {
    const { client } = fakeClient(() => {
      throw sqlState('42501');
    });
    const store = new OwnerKeyPgStore(client);
    const error = await store.mint(PRESENTER, 'k-4', KEY_HASH, ['body']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyDbRefusal);
    expect((error as KeyDbRefusal).code).toBe('scope_missing');
  });

  it('maps SQLSTATE 53400 (live key cap) to conflict', async () => {
    const { client } = fakeClient(() => {
      throw sqlState('53400');
    });
    const error = await new OwnerKeyPgStore(client)
      .mint(PRESENTER, 'k-5', KEY_HASH, ['read'])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyDbRefusal);
    expect((error as KeyDbRefusal).code).toBe('conflict');
  });

  it('rethrows any other database error unchanged, so no value is returned', async () => {
    const boom = sqlState('08006');
    const { client } = fakeClient(() => {
      throw boom;
    });
    const error = await new OwnerKeyPgStore(client)
      .mint(PRESENTER, 'k-6', KEY_HASH, ['read'])
      .catch((e: unknown) => e);
    expect(error).toBe(boom);
  });
});

describe('OwnerKeyPgStore: revoke', () => {
  it('true when a live key of the owner was revoked, false when not found, null when refused', async () => {
    const yes = new OwnerKeyPgStore(fakeClient(() => [{ ok: true }]).client);
    const no = new OwnerKeyPgStore(fakeClient(() => [{ ok: false }]).client);
    const refused = new OwnerKeyPgStore(fakeClient(() => [{ ok: null }]).client);
    expect(await yes.revoke(PRESENTER, 'k-7')).toBe(true);
    expect(await no.revoke(PRESENTER, 'k-7')).toBe(false);
    expect(await refused.revoke(PRESENTER, 'k-7')).toBeNull();
  });

  it('maps SQLSTATE 42501 from revoke to scope_missing', async () => {
    const { client } = fakeClient(() => {
      throw sqlState('42501');
    });
    const error = await new OwnerKeyPgStore(client)
      .revoke(PRESENTER, 'k-8')
      .catch((e: unknown) => e);
    expect((error as KeyDbRefusal).code).toBe('scope_missing');
  });
});

describe('OwnerKeyPgStore: session-keyed functions (0035)', () => {
  const SESSION = Buffer.alloc(32, 3);

  it('mintBySession passes the identity hash and returns the expiry', async () => {
    const expires = new Date('2026-04-01T00:00:00Z');
    const { client, calls } = fakeClient(() => [{ expires_at: expires }]);
    const at = await new OwnerKeyPgStore(client).mintBySession(SESSION, 'k-s1', KEY_HASH, [
      'read',
      'body',
    ]);
    expect(at).toEqual(expires);
    expect(calls[0]?.text).toContain('register_session_mint_owner_key($1, $2, $3, $4)');
    expect(calls[0]?.values).toEqual([SESSION, 'k-s1', KEY_HASH, ['read', 'body']]);
  });

  it('mintBySession maps 42501 to scope_missing and 53400 to conflict, and rethrows any other error', async () => {
    const boom = sqlState('08006');
    const denied = new OwnerKeyPgStore(
      fakeClient(() => {
        throw sqlState('42501');
      }).client,
    );
    const capped = new OwnerKeyPgStore(
      fakeClient(() => {
        throw sqlState('53400');
      }).client,
    );
    const broken = new OwnerKeyPgStore(
      fakeClient(() => {
        throw boom;
      }).client,
    );
    const a = await denied.mintBySession(SESSION, 'k', KEY_HASH, ['read']).catch((e: unknown) => e);
    const b = await capped.mintBySession(SESSION, 'k', KEY_HASH, ['read']).catch((e: unknown) => e);
    const c = await broken.mintBySession(SESSION, 'k', KEY_HASH, ['read']).catch((e: unknown) => e);
    expect((a as KeyDbRefusal).code).toBe('scope_missing');
    expect((b as KeyDbRefusal).code).toBe('conflict');
    expect(c).toBe(boom);
  });

  it('listBySession: a refusal (42501, banned or unknown identity) throws scope_missing, never an empty list', async () => {
    const { client } = fakeClient(() => {
      throw sqlState('42501');
    });
    const error = await new OwnerKeyPgStore(client).listBySession(SESSION).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyDbRefusal);
    expect((error as KeyDbRefusal).code).toBe('scope_missing');
  });

  it('listBySession: zero rows is an owner with no keys (an empty successful list), not a refusal', async () => {
    const { client } = fakeClient(() => []);
    expect(await new OwnerKeyPgStore(client).listBySession(SESSION)).toEqual([]);
  });

  it('listBySession maps each row to the six listing fields only (no value, no hash)', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const { client, calls } = fakeClient(() => [
      {
        key_id: 'k-9',
        scopes: ['read'],
        created_at: created,
        expires_at: created,
        revoked_at: null,
        last_used_at: null,
        key_hash: KEY_HASH,
      },
    ]);
    const rows = await new OwnerKeyPgStore(client).listBySession(SESSION);
    expect(calls[0]?.text).toContain('register_session_list_owner_keys($1)');
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'keyId',
      'lastUsedAt',
      'revokedAt',
      'scopes',
    ]);
  });

  it('revokeBySession: true, false, null and 42501 (scope_missing) are told apart', async () => {
    const yes = new OwnerKeyPgStore(fakeClient(() => [{ ok: true }]).client);
    const no = new OwnerKeyPgStore(fakeClient(() => [{ ok: false }]).client);
    const refused = new OwnerKeyPgStore(fakeClient(() => [{ ok: null }]).client);
    const denied = new OwnerKeyPgStore(
      fakeClient(() => {
        throw sqlState('42501');
      }).client,
    );
    expect(await yes.revokeBySession(SESSION, 'k-7')).toBe(true);
    expect(await no.revokeBySession(SESSION, 'k-7')).toBe(false);
    expect(await refused.revokeBySession(SESSION, 'k-7')).toBeNull();
    const error = await denied.revokeBySession(SESSION, 'k-7').catch((e: unknown) => e);
    expect((error as KeyDbRefusal).code).toBe('scope_missing');
  });
});
