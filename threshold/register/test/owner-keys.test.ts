import { describe, expect, it } from 'vitest';
import {
  hashOwnerKey,
  newOwnerKey,
  OWNER_KEY_LIFETIME_MS,
  ownerKeyExpiresAt,
} from '../src/owner-keys-policy.ts';
import {
  listOwnerKeys,
  mintOwnerKey,
  type OwnerKeyAuditEntry,
  type OwnerKeyDeps,
  type OwnerKeyRow,
  type OwnerKeyStore,
  revokeOwnerKey,
} from '../src/owner-keys-service.ts';

const PEPPER = 'p'.repeat(32);
const NOW = new Date('2026-11-13T12:00:00Z');

interface Fake {
  id: string;
  ownerId: string;
  scopes: string[];
  keyHash: Buffer;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** A store that keeps the rules of 0026 in memory: owner-scoped, manage to mint or revoke, read to list. */
function fakeStore(keys: Fake[], opts: { mintThrows?: boolean; banned?: string[] } = {}) {
  const rows: Fake[] = [...keys];
  const audits: string[] = [];
  const calls = { resolve: 0 };
  const store: OwnerKeyStore = {
    async resolve(hash) {
      calls.resolve += 1;
      const k = rows.find((r) => r.keyHash.equals(hash));
      if (!k) return null;
      if (k.revokedAt !== null || k.expiresAt <= NOW || opts.banned?.includes(k.ownerId)) {
        audits.push(`key.use:${k.id}:refused`);
        return null;
      }
      return { ownerId: k.ownerId, scopes: k.scopes };
    },
    async mint(presenterHash, keyId, keyHash, scopes) {
      if (opts.mintThrows) throw new Error('connection reset');
      const who = await store.resolve(presenterHash);
      if (!who || !who.scopes.includes('manage')) return null;
      rows.push({
        id: keyId,
        ownerId: who.ownerId,
        scopes,
        keyHash,
        expiresAt: ownerKeyExpiresAt(NOW),
        revokedAt: null,
      });
      return ownerKeyExpiresAt(NOW);
    },
    async revoke(presenterHash, keyId) {
      const who = await store.resolve(presenterHash);
      if (!who || !who.scopes.includes('manage')) return null;
      const k = rows.find(
        (r) => r.id === keyId && r.ownerId === who.ownerId && r.revokedAt === null,
      );
      if (!k) return false;
      k.revokedAt = NOW;
      return true;
    },
    async list(presenterHash) {
      const who = await store.resolve(presenterHash);
      if (!who || !who.scopes.includes('read')) return null;
      return rows
        .filter((r) => r.ownerId === who.ownerId)
        .map(
          (r): OwnerKeyRow => ({
            keyId: r.id,
            scopes: r.scopes,
            createdAt: NOW,
            expiresAt: r.expiresAt,
            revokedAt: r.revokedAt,
            lastUsedAt: null,
          }),
        );
    },
  };
  return { store, rows, audits, calls };
}

function key(
  id: string,
  ownerId: string,
  scopes: string[],
  value: string,
  extra: Partial<Fake> = {},
): Fake {
  return {
    id,
    ownerId,
    scopes,
    keyHash: hashOwnerKey(PEPPER, value),
    expiresAt: new Date(NOW.getTime() + 1000 * 60 * 60),
    revokedAt: null,
    ...extra,
  };
}

const MANAGE = `gowner-${'a1'.repeat(32)}`;
const READ_ONLY = `gowner-${'a2'.repeat(32)}`;
const OTHER = `gowner-${'b1'.repeat(32)}`;
const ADMIN = `gowner-${'d1'.repeat(32)}`;

function deps(
  store: OwnerKeyStore,
  audits: string[],
  o: { admin?: boolean; windowAllows?: number } = {},
): OwnerKeyDeps & { charges: number } {
  let allowed = o.windowAllows ?? Number.POSITIVE_INFINITY;
  const state = { charges: 0 };
  return {
    store,
    isAdmin: async () => o.admin ?? false,
    charge: () => {
      state.charges += 1;
      if (allowed > 0) {
        allowed -= 1;
        return 0;
      }
      return 60;
    },
    hash: (value) => hashOwnerKey(PEPPER, value),
    issue: () => newOwnerKey(),
    audit: async (e: OwnerKeyAuditEntry) => {
      audits.push(`${e.action}:${e.outcome}:${e.admin}`);
    },
    now: () => NOW,
    get charges() {
      return state.charges;
    },
  } as OwnerKeyDeps & { charges: number };
}

describe('owner key format and hashing', () => {
  it('refuses a player token shape before any database call', async () => {
    const fake = fakeStore([key('gok-0000000000000001', 'o1', ['manage'], MANAGE)]);
    const result = await mintOwnerKey(deps(fake.store, fake.audits), 'gplayer-' + 'a1'.repeat(32), [
      'read',
    ]);
    expect(result).toEqual({ status: 'refused' });
    expect(fake.audits).toEqual([]);
    expect(fake.calls.resolve).toBe(0);
  });

  it('refuses a bad-length owner key shape before any database call', async () => {
    const fake = fakeStore([key('gok-0000000000000001', 'o1', ['manage'], MANAGE)]);
    const short = `gowner-${'a1'.repeat(10)}`;
    const result = await mintOwnerKey(deps(fake.store, fake.audits), short, ['read']);
    expect(result).toEqual({ status: 'refused' });
    expect(fake.audits).toEqual([]);
    expect(fake.calls.resolve).toBe(0);
  });

  it('stores the hash, never the value, and the listing shows no value', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['read', 'manage'], MANAGE)]);
    const d = deps(fake.store, fake.audits);
    const minted = await mintOwnerKey(d, MANAGE, ['read']);
    expect(minted.status).toBe('minted');
    if (minted.status !== 'minted') return;
    expect(minted.value).toMatch(/^gowner-[0-9a-f]{64}$/);
    const stored = JSON.stringify(
      fake.rows.map((r) => ({ ...r, keyHash: r.keyHash.toString('hex') })),
    );
    expect(stored).not.toContain(minted.value);
    expect(
      fake.rows
        .find((r) => r.id === minted.keyId)
        ?.keyHash.equals(hashOwnerKey(PEPPER, minted.value)),
    ).toBe(true);
    const listed = await listOwnerKeys(d, MANAGE);
    expect(JSON.stringify(listed)).not.toContain(minted.value);
  });

  it('gives a key the 90 day lifetime', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['read', 'manage'], MANAGE)]);
    const minted = await mintOwnerKey(deps(fake.store, fake.audits), MANAGE, ['read']);
    expect(minted.status === 'minted' && minted.expiresAt.getTime() - NOW.getTime()).toBe(
      OWNER_KEY_LIFETIME_MS,
    );
  });
});

describe('scopes', () => {
  it('a key without manage cannot mint a key (scope_missing, audited, nothing stored)', async () => {
    const fake = fakeStore([key('gok-00000000000000a2', 'o1', ['read'], READ_ONLY)]);
    const d = deps(fake.store, fake.audits);
    const result = await mintOwnerKey(d, READ_ONLY, ['read']);
    expect(result).toEqual({ status: 'scope_missing' });
    expect(fake.rows).toHaveLength(1);
    expect(fake.audits).toEqual(['key.mint:scope_missing:false']);
    expect(d.charges).toBe(0);
  });

  it('a key cannot mint a scope it does not hold, and an unknown scope is bad_scopes', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['read', 'manage'], MANAGE)]);
    const d = deps(fake.store, fake.audits);
    expect(await mintOwnerKey(d, MANAGE, ['body', 'admin'])).toEqual({ status: 'bad_scopes' });
    const narrow = fakeStore([key('gok-00000000000000a1', 'o1', ['manage'], MANAGE)]);
    expect(await mintOwnerKey(deps(narrow.store, narrow.audits), MANAGE, ['read', 'body'])).toEqual(
      {
        status: 'bad_scopes',
      },
    );
    expect(d.charges).toBe(0);
  });

  it('listing needs read: a body-only key lists nothing', async () => {
    const fake = fakeStore([
      key('gok-00000000000000a3', 'o1', ['body'], `gowner-${'a3'.repeat(32)}`),
    ]);
    const result = await listOwnerKeys(deps(fake.store, fake.audits), `gowner-${'a3'.repeat(32)}`);
    expect(result).toEqual({ status: 'scope_missing' });
  });
});

describe('revoke and refusals', () => {
  it('revoke is immediate: the revoked key is refused on its next use', async () => {
    const fake = fakeStore([
      key('gok-00000000000000a1', 'o1', ['manage'], MANAGE),
      key('gok-00000000000000a2', 'o1', ['read'], READ_ONLY),
    ]);
    const d = deps(fake.store, fake.audits);
    expect(await revokeOwnerKey(d, MANAGE, 'gok-00000000000000a2')).toEqual({ status: 'revoked' });
    expect(await listOwnerKeys(d, READ_ONLY)).toEqual({ status: 'refused' });
  });

  it("a cross-owner revoke is not_found and the other owner's key stays live", async () => {
    const fake = fakeStore([
      key('gok-00000000000000a1', 'o1', ['manage'], MANAGE),
      key('gok-00000000000000b1', 'o2', ['manage'], OTHER),
    ]);
    const d = deps(fake.store, fake.audits);
    expect(await revokeOwnerKey(d, OTHER, 'gok-00000000000000a1')).toEqual({ status: 'not_found' });
    expect(fake.rows.find((r) => r.id === 'gok-00000000000000a1')?.revokedAt).toBeNull();
    expect(fake.audits).toEqual(['key.revoke:not_found:false']);
  });

  it('a banned owner refuses its key on every action', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['manage'], MANAGE)], {
      banned: ['o1'],
    });
    expect(await listOwnerKeys(deps(fake.store, fake.audits), MANAGE)).toEqual({
      status: 'refused',
    });
  });
});

describe('window and admin', () => {
  it('a normal owner: the last allowed mint succeeds, the next is limited and audited', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['read', 'manage'], MANAGE)]);
    const d = deps(fake.store, fake.audits, { windowAllows: 2 });
    expect((await mintOwnerKey(d, MANAGE, ['read'])).status).toBe('minted');
    expect((await mintOwnerKey(d, MANAGE, ['read'])).status).toBe('minted');
    expect(await mintOwnerKey(d, MANAGE, ['read'])).toEqual({ status: 'limited', retryAfter: 60 });
    expect(fake.audits).toContain('key.mint:limited:false');
  });

  it('an admin mints beyond the window (the window is skipped, not charged)', async () => {
    const fake = fakeStore([key('gok-00000000000000d1', 'o4', ['read', 'manage'], ADMIN)]);
    const d = deps(fake.store, fake.audits, { admin: true, windowAllows: 0 });
    for (let i = 0; i < 3; i += 1) {
      expect((await mintOwnerKey(d, ADMIN, ['read'])).status).toBe('minted');
    }
    expect(d.charges).toBe(0);
  });

  it('a revoke is windowed too: a normal owner over the window is limited', async () => {
    const fake = fakeStore([
      key('gok-00000000000000a1', 'o1', ['manage'], MANAGE),
      key('gok-00000000000000a2', 'o1', ['read'], READ_ONLY),
    ]);
    const d = deps(fake.store, fake.audits, { windowAllows: 0 });
    expect(await revokeOwnerKey(d, MANAGE, 'gok-00000000000000a2')).toEqual({
      status: 'limited',
      retryAfter: 60,
    });
    expect(fake.rows.find((r) => r.id === 'gok-00000000000000a2')?.revokedAt).toBeNull();
  });
});

describe('abort and error paths', () => {
  it('a database error during mint returns no value and stores no key', async () => {
    const fake = fakeStore([key('gok-00000000000000a1', 'o1', ['read', 'manage'], MANAGE)], {
      mintThrows: true,
    });
    const d = deps(fake.store, fake.audits);
    await expect(mintOwnerKey(d, MANAGE, ['read'])).rejects.toThrow('connection reset');
    expect(fake.rows).toHaveLength(1);
    expect(fake.audits).toEqual(['key.mint:error:false']);
  });
});
