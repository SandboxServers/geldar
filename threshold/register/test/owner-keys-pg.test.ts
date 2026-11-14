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
