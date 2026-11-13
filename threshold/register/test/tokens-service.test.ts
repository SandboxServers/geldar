import { describe, expect, it } from 'vitest';
import { tokenUsable } from '../src/tokens-policy.ts';
import {
  type AuditActionEntry,
  type IssuedToken,
  playerTokenStatus,
  renewPlayerToken,
  revokePlayerTokens,
  type TokenDeps,
  type TokenStore,
} from '../src/tokens-service.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date('2026-11-13T12:00:00.000Z');
const ACTOR = { identityHash: 'aa'.repeat(32), ownerId: 'owner-1' };
const PLAYER = 'ag-token-test-01';

interface Probe {
  audits: AuditActionEntry[];
  charges: string[];
  renews: Array<{ playerId: string; token: IssuedToken; graceUntil: Date }>;
  issued: () => number;
}

/** A store and deps with one injected result per call; `waits` is the window's answer for each call in turn. */
function makeDeps(
  options: { admin?: boolean; waits?: number[]; now?: Date; store?: Partial<TokenStore> } = {},
): { deps: TokenDeps; probe: Probe } {
  const probe: Probe = { audits: [], charges: [], renews: [], issued: () => issuedCount };
  let issuedCount = 0;
  const waits = [...(options.waits ?? [])];
  const store: TokenStore = {
    renewToken: async (_identity, playerId, token, graceUntil) => {
      probe.renews.push({ playerId, token, graceUntil });
      return true;
    },
    revokeTokens: async () => 1,
    tokenInfo: async () => null,
    ...options.store,
  };
  const deps: TokenDeps = {
    store,
    isAdmin: async () => options.admin ?? false,
    charge: (ownerId) => {
      probe.charges.push(ownerId);
      return waits.shift() ?? 0;
    },
    audit: async (entry) => {
      probe.audits.push(entry);
    },
    issue: () => {
      issuedCount += 1;
      return {
        tokenId: `tok-${issuedCount}`,
        tokenHash: Buffer.alloc(32, issuedCount),
        secret: `secret-${issuedCount}`,
      };
    },
    now: () => options.now ?? NOW,
  };
  return { deps, probe };
}

describe('renewal', () => {
  it('rotates to a new 90 day token for the same player and shows the secret once', async () => {
    const { deps, probe } = makeDeps();
    const result = await renewPlayerToken(deps, ACTOR, PLAYER);
    expect(result).toEqual({
      status: 'renewed',
      secret: 'secret-1',
      expiresAt: new Date(NOW.getTime() + 90 * DAY),
    });
    expect(probe.renews).toHaveLength(1);
    expect(probe.renews[0]?.playerId).toBe(PLAYER);
    expect(probe.renews[0]?.token.tokenId).toBe('tok-1');
  });

  it('gives the old token 10 minutes: accepted at 10:00 after the rotation, refused at 10:01', async () => {
    const { deps, probe } = makeDeps();
    await renewPlayerToken(deps, ACTOR, PLAYER);
    const graceUntil = probe.renews[0]?.graceUntil;
    expect(graceUntil?.getTime()).toBe(NOW.getTime() + 10 * MIN + 1000);
    if (graceUntil === undefined) throw new Error('no grace end passed to the store');
    expect(tokenUsable(graceUntil, null, new Date(NOW.getTime() + 10 * MIN))).toBe(true);
    expect(tokenUsable(graceUntil, null, new Date(NOW.getTime() + 10 * MIN + 1000))).toBe(false);
  });

  it('refuses a renewal the database refuses (not the owner, banned, retired): not_found, no secret', async () => {
    const { deps, probe } = makeDeps({ store: { renewToken: async () => false } });
    const result = await renewPlayerToken(deps, ACTOR, PLAYER);
    expect(result).toEqual({ status: 'not_found' });
    expect(probe.audits).toEqual([
      {
        ownerId: 'owner-1',
        action: 'token.renew',
        target: PLAYER,
        outcome: 'not_found',
        admin: false,
      },
    ]);
  });

  it('a database error mid-renewal returns no value and writes one error row', async () => {
    const { deps, probe } = makeDeps({
      store: {
        renewToken: async () => {
          throw new Error('connection reset');
        },
      },
    });
    await expect(renewPlayerToken(deps, ACTOR, PLAYER)).rejects.toThrow('connection reset');
    expect(probe.audits).toHaveLength(1);
    expect(probe.audits[0]?.outcome).toBe('error');
  });

  it('the second renewal inside the window is refused (retry-after) and the store is not called', async () => {
    const { deps, probe } = makeDeps({ waits: [0, 30] });
    expect((await renewPlayerToken(deps, ACTOR, PLAYER)).status).toBe('renewed');
    expect(await renewPlayerToken(deps, ACTOR, PLAYER)).toEqual({
      status: 'limited',
      retryAfter: 30,
    });
    expect(probe.renews).toHaveLength(1);
  });

  it('an admin owner is exempt from the window: the same sequence is accepted', async () => {
    const { deps, probe } = makeDeps({ admin: true, waits: [30, 30] });
    expect((await renewPlayerToken(deps, ACTOR, PLAYER)).status).toBe('renewed');
    expect((await renewPlayerToken(deps, ACTOR, PLAYER)).status).toBe('renewed');
    expect(probe.charges).toEqual([]);
    expect(probe.renews).toHaveLength(2);
  });

  it('an admin owner renewing another owner player is still not_found and is audited as admin', async () => {
    const { deps, probe } = makeDeps({
      admin: true,
      store: { renewToken: async () => false },
    });
    expect(await renewPlayerToken(deps, ACTOR, 'ag-other-owner-01')).toEqual({
      status: 'not_found',
    });
    expect(probe.audits).toEqual([
      {
        ownerId: 'owner-1',
        action: 'token.renew',
        target: 'ag-other-owner-01',
        outcome: 'not_found',
        admin: true,
      },
    ]);
  });

  it('writes exactly one audit row per renewal, admin only for the admin', async () => {
    const normal = makeDeps();
    await renewPlayerToken(normal.deps, ACTOR, PLAYER);
    expect(normal.probe.audits).toEqual([
      {
        ownerId: 'owner-1',
        action: 'token.renew',
        target: PLAYER,
        outcome: 'renewed',
        admin: false,
      },
    ]);
    const admin = makeDeps({ admin: true });
    await renewPlayerToken(admin.deps, ACTOR, PLAYER);
    expect(admin.probe.audits).toHaveLength(1);
    expect(admin.probe.audits[0]?.admin).toBe(true);
  });
});

describe('revoke-only', () => {
  it('ends the live tokens and mints no replacement', async () => {
    const { deps, probe } = makeDeps({ store: { revokeTokens: async () => 2 } });
    expect(await revokePlayerTokens(deps, ACTOR, PLAYER)).toEqual({ status: 'revoked', count: 2 });
    expect(probe.issued()).toBe(0);
    expect(probe.renews).toHaveLength(0);
  });

  it('is refused for a banned owner or another owner player (null from the store) with one audit row', async () => {
    const { deps, probe } = makeDeps({ store: { revokeTokens: async () => null } });
    expect(await revokePlayerTokens(deps, ACTOR, PLAYER)).toEqual({ status: 'not_found' });
    expect(probe.audits).toHaveLength(1);
    expect(probe.audits[0]?.action).toBe('token.revoke');
  });

  it('the window applies to revoke too, and an admin is exempt', async () => {
    const normal = makeDeps({ waits: [5] });
    expect(await revokePlayerTokens(normal.deps, ACTOR, PLAYER)).toEqual({
      status: 'limited',
      retryAfter: 5,
    });
    const admin = makeDeps({ admin: true, waits: [5] });
    expect((await revokePlayerTokens(admin.deps, ACTOR, PLAYER)).status).toBe('revoked');
  });
});

describe('account data', () => {
  it('reports the expiry, last use and the renewal flag from 14 days before expiry', async () => {
    const expiresAt = new Date(NOW.getTime() + 14 * DAY);
    const lastUsedAt = new Date(NOW.getTime() - MIN);
    const atBoundary = makeDeps({ store: { tokenInfo: async () => ({ expiresAt, lastUsedAt }) } });
    expect(await playerTokenStatus(atBoundary.deps, ACTOR, PLAYER)).toEqual({
      expiresAt,
      lastUsedAt,
      renewalDue: true,
      usable: true,
    });
    const oneSecondEarlier = makeDeps({
      now: new Date(NOW.getTime() - 1000),
      store: { tokenInfo: async () => ({ expiresAt, lastUsedAt: null }) },
    });
    expect((await playerTokenStatus(oneSecondEarlier.deps, ACTOR, PLAYER))?.renewalDue).toBe(false);
  });

  it('an owner-banned or foreign player has no token data', async () => {
    const { deps } = makeDeps();
    expect(await playerTokenStatus(deps, ACTOR, PLAYER)).toBeNull();
  });
});
