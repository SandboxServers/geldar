import { graceEndsAt, renewalDue, tokenExpiresAt, tokenUsable } from './tokens-policy.ts';

/** One audit row for a token action; the admin flag is the owner's, read by the caller. */
export interface AuditActionEntry {
  ownerId: string;
  action: string;
  target: string;
  outcome: string;
  admin: boolean;
}

/** One new token: its id, the SHA-256 of its secret, and the secret (shown once, never stored). */
export interface IssuedToken {
  tokenId: string;
  tokenHash: Buffer;
  secret: string;
}

/** The database side. Each method returns null or false when the database refuses (not the owner's, banned, retired). */
export interface TokenStore {
  renewToken(
    identityHash: string,
    playerId: string,
    token: IssuedToken,
    graceUntil: Date,
  ): Promise<boolean>;
  revokeTokens(identityHash: string, playerId: string): Promise<number | null>;
  tokenInfo(
    identityHash: string,
    playerId: string,
  ): Promise<{ expiresAt: Date; lastUsedAt: Date | null } | null>;
}

export interface TokenDeps {
  store: TokenStore;
  /** Reads the admin flag through register_is_admin; false on any error (fails closed). */
  isAdmin: (ownerId: string) => Promise<boolean>;
  /** The register fixed window for this owner: seconds to wait, or 0 when the action may run. */
  charge: (ownerId: string) => number;
  /** Appends one register_audit row for an outcome the database did not write (limited, not_found, error). */
  audit: (entry: AuditActionEntry) => Promise<void>;
  /** Makes the new token. Called after the window check; a refused renewal stores nothing and its secret is dropped. */
  issue: () => IssuedToken;
  now: () => Date;
}

export interface TokenActor {
  identityHash: string;
  ownerId: string;
}

export type TokenResult =
  | { status: 'renewed'; secret: string; expiresAt: Date }
  | { status: 'revoked'; count: number }
  | { status: 'not_found' }
  | { status: 'limited'; retryAfter: number };

/**
 * Runs one token action: the admin check, the window (skipped for an admin), and the database call.
 * A renewal or a revoke writes its audit row inside the database transaction (0032), so it commits or
 * rolls back with the change. Every other outcome (a limit, a refusal, a database error) changed nothing
 * and is audited here. A database error is rethrown; a failing audit on that path does not hide it.
 */
async function act(
  deps: TokenDeps,
  actor: TokenActor,
  playerId: string,
  action: string,
  run: (admin: boolean) => Promise<TokenResult>,
): Promise<TokenResult> {
  const admin = await deps.isAdmin(actor.ownerId);
  let result: TokenResult;
  try {
    result = await run(admin);
  } catch (error) {
    await deps
      .audit({ ownerId: actor.ownerId, action, target: playerId, outcome: 'error', admin })
      .catch(() => undefined);
    throw error;
  }
  if (result.status !== 'renewed' && result.status !== 'revoked') {
    await deps.audit({
      ownerId: actor.ownerId,
      action,
      target: playerId,
      outcome: result.status,
      admin,
    });
  }
  return result;
}

/** The window check. An admin owner is exempt; every other rule still applies to an admin. */
function windowWait(deps: TokenDeps, actor: TokenActor, admin: boolean): number {
  return admin ? 0 : deps.charge(actor.ownerId);
}

/** Renews the player's token: a new 90 day token for the same player; the old one keeps 10 minutes. */
export function renewPlayerToken(
  deps: TokenDeps,
  actor: TokenActor,
  playerId: string,
): Promise<TokenResult> {
  return act(deps, actor, playerId, 'token.renew', async (admin) => {
    const wait = windowWait(deps, actor, admin);
    if (wait > 0) return { status: 'limited', retryAfter: wait };
    const now = deps.now();
    const token = deps.issue();
    const renewed = await deps.store.renewToken(
      actor.identityHash,
      playerId,
      token,
      graceEndsAt(now),
    );
    if (!renewed) return { status: 'not_found' };
    return { status: 'renewed', secret: token.secret, expiresAt: tokenExpiresAt(now) };
  });
}

/** Revokes every live token of the player. No replacement is minted. */
export function revokePlayerTokens(
  deps: TokenDeps,
  actor: TokenActor,
  playerId: string,
): Promise<TokenResult> {
  return act(deps, actor, playerId, 'token.revoke', async (admin) => {
    const wait = windowWait(deps, actor, admin);
    if (wait > 0) return { status: 'limited', retryAfter: wait };
    const count = await deps.store.revokeTokens(actor.identityHash, playerId);
    if (count === null) return { status: 'not_found' };
    return { status: 'revoked', count };
  });
}

/** The account data for one player's token. A read, so no audit row. Null when the database refuses. */
export async function playerTokenStatus(
  deps: TokenDeps,
  actor: TokenActor,
  playerId: string,
): Promise<{
  expiresAt: Date;
  lastUsedAt: Date | null;
  renewalDue: boolean;
  usable: boolean;
} | null> {
  const info = await deps.store.tokenInfo(actor.identityHash, playerId);
  if (info === null) return null;
  const now = deps.now();
  return {
    expiresAt: info.expiresAt,
    lastUsedAt: info.lastUsedAt,
    renewalDue: renewalDue(info.expiresAt, now),
    usable: tokenUsable(info.expiresAt, null, now),
  };
}
