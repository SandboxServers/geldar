import { describe, expect, it } from 'vitest';
import { KeyDbRefusal } from '../src/owner-keys-pg.ts';
import {
  hashOwnerKey,
  OWNER_KEY_LIFETIME_MS,
  type OwnerKeyScope,
} from '../src/owner-keys-policy.ts';
import {
  listOwnerKeysBySession,
  mintOwnerKeyBySession,
  type OwnerKeyAuditEntry,
  type OwnerKeyRow,
  type OwnerKeySessionStore,
  revokeOwnerKeyBySession,
  type SessionKeyDeps,
} from '../src/owner-keys-service.ts';

const PEPPER = 'p'.repeat(32);
const NOW = new Date('2026-11-13T12:00:00Z');
const OWNER_IDENT = Buffer.alloc(32, 1);
const OTHER_IDENT = Buffer.alloc(32, 2);
const BANNED_IDENT = Buffer.alloc(32, 3);
const UNKNOWN_IDENT = Buffer.alloc(32, 4);

interface Row extends OwnerKeyRow {
  ownerId: string;
  keyHash: Buffer;
}

interface WorldOptions {
  admin?: boolean;
  limited?: boolean;
  store?: Partial<OwnerKeySessionStore>;
}

/**
 * An in-memory world with the 0035 rules: the identity names its owner, a banned or unknown identity raises
 * 42501 (scope_missing), the 11th live key raises 53400 (conflict), and a revoke is owner-scoped.
 */
function world(opts: WorldOptions = {}) {
  const owners = new Map<string, { ownerId: string; banned: boolean }>([
    [OWNER_IDENT.toString('hex'), { ownerId: 'o-1', banned: false }],
    [OTHER_IDENT.toString('hex'), { ownerId: 'o-2', banned: false }],
    [BANNED_IDENT.toString('hex'), { ownerId: 'o-3', banned: true }],
  ]);
  const rows: Row[] = [];
  const audits: OwnerKeyAuditEntry[] = [];
  const ownerOf = (identityHash: Buffer): string => {
    const found = owners.get(identityHash.toString('hex'));
    if (!found || found.banned) throw new KeyDbRefusal('scope_missing', '42501');
    return found.ownerId;
  };
  const session: OwnerKeySessionStore = {
    async mintBySession(identityHash, keyId, keyHash, scopes: OwnerKeyScope[]) {
      const who = ownerOf(identityHash);
      const live = rows.filter((r) => r.ownerId === who && r.revokedAt === null).length;
      if (live >= 10) throw new KeyDbRefusal('conflict', '53400');
      const expiresAt = new Date(NOW.getTime() + OWNER_KEY_LIFETIME_MS);
      rows.push({
        keyId,
        ownerId: who,
        keyHash,
        scopes: [...scopes],
        createdAt: NOW,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      });
      return expiresAt;
    },
    async revokeBySession(identityHash, keyId) {
      const who = ownerOf(identityHash);
      const row = rows.find((r) => r.keyId === keyId && r.ownerId === who && r.revokedAt === null);
      if (!row) return false;
      row.revokedAt = NOW;
      return true;
    },
    async listBySession(identityHash) {
      const who = ownerOf(identityHash);
      return rows
        .filter((r) => r.ownerId === who)
        .map(({ keyId, scopes, createdAt, expiresAt, revokedAt, lastUsedAt }) => ({
          keyId,
          scopes,
          createdAt,
          expiresAt,
          revokedAt,
          lastUsedAt,
        }));
    },
    ...opts.store,
  };
  const deps: SessionKeyDeps = {
    session,
    resolveOwner: async (identityHash) => owners.get(identityHash.toString('hex')) ?? null,
    isAdmin: async () => opts.admin ?? false,
    charge: () => (opts.limited ? 30 : 0),
    hash: (value) => hashOwnerKey(PEPPER, value),
    issue: () => ({ keyId: `k-${rows.length + 1}`, value: `value-${rows.length + 1}-secret` }),
    audit: async (entry) => {
      audits.push(entry);
    },
    now: () => NOW,
  };
  return { deps, rows, audits };
}

describe('mintOwnerKeyBySession', () => {
  it('mints for the signed-in owner, returns the value once, and stores only its hash', async () => {
    const { deps, rows, audits } = world();
    const result = await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read', 'body']);
    expect(result).toMatchObject({ status: 'minted', scopes: ['read', 'body'] });
    if (result.status !== 'minted') throw new Error('expected minted');
    expect(result.value).toBe('value-1-secret');
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + OWNER_KEY_LIFETIME_MS);
    expect(rows[0]?.ownerId).toBe('o-1');
    expect(rows[0]?.keyHash.equals(hashOwnerKey(PEPPER, 'value-1-secret'))).toBe(true);
    expect(rows[0]?.keyHash.toString()).not.toContain('value-1-secret');
    expect(audits).toEqual([]);
  });

  it('refuses a scope that is not one of read, body or manage, and stores nothing', async () => {
    const { deps, rows, audits } = world();
    expect(await mintOwnerKeyBySession(deps, OWNER_IDENT, ['admin'])).toEqual({
      status: 'bad_scopes',
    });
    expect(rows).toHaveLength(0);
    expect(audits).toEqual([
      { ownerId: 'o-1', action: 'key.mint', target: '', outcome: 'bad_scopes', admin: false },
    ]);
  });

  it('refuses a banned or unknown identity before the database, with no audit row', async () => {
    const { deps, rows, audits } = world();
    expect(await mintOwnerKeyBySession(deps, BANNED_IDENT, ['read'])).toEqual({
      status: 'refused',
    });
    expect(await mintOwnerKeyBySession(deps, UNKNOWN_IDENT, ['read'])).toEqual({
      status: 'refused',
    });
    expect(rows).toHaveLength(0);
    expect(audits).toEqual([]);
  });

  it('is limited by the window for a non-admin, and an admin skips the window', async () => {
    const limited = world({ limited: true });
    expect(await mintOwnerKeyBySession(limited.deps, OWNER_IDENT, ['read'])).toEqual({
      status: 'limited',
      retryAfter: 30,
    });
    expect(limited.rows).toHaveLength(0);
    expect(limited.audits.map((a) => a.outcome)).toEqual(['limited']);
    const admin = world({ limited: true, admin: true });
    expect((await mintOwnerKeyBySession(admin.deps, OWNER_IDENT, ['read'])).status).toBe('minted');
  });

  it('maps the 53400 live key cap to a conflict error, audits it as error, and returns no value', async () => {
    const { deps, rows, audits } = world();
    for (let i = 0; i < 10; i += 1) {
      await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read']);
    }
    const error = await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyDbRefusal);
    expect((error as KeyDbRefusal).code).toBe('conflict');
    expect(rows).toHaveLength(10);
    expect(audits.at(-1)).toMatchObject({ action: 'key.mint', outcome: 'error' });
  });
});

describe('listOwnerKeysBySession', () => {
  it('lists the signed-in owner keys and never the value or the hash', async () => {
    const { deps } = world();
    const minted = await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read']);
    expect(minted.status).toBe('minted');
    await mintOwnerKeyBySession(deps, OTHER_IDENT, ['read']);
    const listed = await listOwnerKeysBySession(deps, OWNER_IDENT);
    if (listed.status !== 'listed') throw new Error('expected listed');
    expect(listed.keys.map((k) => k.keyId)).toEqual(['k-1']);
    expect(Object.keys(listed.keys[0] ?? {}).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'keyId',
      'lastUsedAt',
      'revokedAt',
      'scopes',
    ]);
    expect(JSON.stringify(listed)).not.toContain('value-1-secret');
  });

  it('an owner with no keys is an empty successful list', async () => {
    const { deps } = world();
    expect(await listOwnerKeysBySession(deps, OWNER_IDENT)).toEqual({ status: 'listed', keys: [] });
  });

  it('a banned or unknown identity is refused, never listed as an empty owner', async () => {
    const { deps } = world();
    expect(await listOwnerKeysBySession(deps, BANNED_IDENT)).toEqual({ status: 'refused' });
    expect(await listOwnerKeysBySession(deps, UNKNOWN_IDENT)).toEqual({ status: 'refused' });
  });

  it('a 42501 raised by the database is thrown as scope_missing and audited as error', async () => {
    const { deps, audits } = world({
      store: {
        listBySession: async () => {
          throw new KeyDbRefusal('scope_missing', '42501');
        },
      },
    });
    const error = await listOwnerKeysBySession(deps, OWNER_IDENT).catch((e: unknown) => e);
    expect((error as KeyDbRefusal).code).toBe('scope_missing');
    expect(audits).toEqual([
      { ownerId: 'o-1', action: 'key.list', target: '', outcome: 'error', admin: false },
    ]);
  });
});

describe('revokeOwnerKeyBySession', () => {
  it('revokes one of the owner keys, and another owner key is not found', async () => {
    const { deps, rows } = world();
    await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read']);
    await mintOwnerKeyBySession(deps, OTHER_IDENT, ['read']);
    expect(await revokeOwnerKeyBySession(deps, OWNER_IDENT, 'k-2')).toEqual({
      status: 'not_found',
    });
    expect(rows[1]?.revokedAt).toBeNull();
    expect(await revokeOwnerKeyBySession(deps, OWNER_IDENT, 'k-1')).toEqual({ status: 'revoked' });
    expect(rows[0]?.revokedAt).toEqual(NOW);
  });

  it('a banned identity is refused and revokes nothing', async () => {
    const { deps, rows } = world();
    await mintOwnerKeyBySession(deps, OWNER_IDENT, ['read']);
    expect(await revokeOwnerKeyBySession(deps, BANNED_IDENT, 'k-1')).toEqual({ status: 'refused' });
    expect(rows[0]?.revokedAt).toBeNull();
  });
});
