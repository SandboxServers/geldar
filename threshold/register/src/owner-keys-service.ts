import {
  hasScope,
  isOwnerKeyShape,
  type NewOwnerKey,
  type OwnerKeyScope,
  parseScopes,
} from './owner-keys-policy.ts';

/** One key as the listing shows it: never the value, never the hash. */
export interface OwnerKeyRow {
  keyId: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/** The database side. Each method takes the presented key's hash; null means the database refused the presenter. */
export interface OwnerKeyStore {
  /** The owner and scopes of a live key; null when unknown, revoked, expired or the owner is banned. */
  resolve(presenterHash: Buffer): Promise<{ ownerId: string; scopes: string[] } | null>;
  /** Writes the key row and its audit row in one transaction; returns the expiry, or null when refused. */
  mint(
    presenterHash: Buffer,
    keyId: string,
    keyHash: Buffer,
    scopes: OwnerKeyScope[],
  ): Promise<Date | null>;
  /** True when revoked, false when the target is not a live key of that owner, null when refused. */
  revoke(presenterHash: Buffer, keyId: string): Promise<boolean | null>;
  /** The presenter owner's keys; null when refused or the presenter lacks read. */
  list(presenterHash: Buffer): Promise<OwnerKeyRow[] | null>;
}

export interface OwnerKeyAuditEntry {
  ownerId: string;
  action: string;
  target: string;
  outcome: string;
  admin: boolean;
}

export interface OwnerKeyDeps {
  store: OwnerKeyStore;
  /** Reads the admin flag through register_is_admin; false on any error (fails closed). */
  isAdmin: (ownerId: string) => Promise<boolean>;
  /** The register fixed window for this owner: seconds to wait, or 0 when the action may run. */
  charge: (ownerId: string) => number;
  /** HMAC-SHA256 of a key value under the token pepper. */
  hash: (value: string) => Buffer;
  /** Makes a new key id and value. Called after the checks; a refused mint stores nothing. */
  issue: () => NewOwnerKey;
  /** Appends one audit row for an outcome the database did not write. */
  audit: (entry: OwnerKeyAuditEntry) => Promise<void>;
  now: () => Date;
}

export type OwnerKeyResult =
  | { status: 'minted'; keyId: string; value: string; scopes: OwnerKeyScope[]; expiresAt: Date }
  | { status: 'revoked' }
  | { status: 'listed'; keys: OwnerKeyRow[] }
  | { status: 'refused' }
  | { status: 'scope_missing' }
  | { status: 'bad_scopes' }
  | { status: 'not_found' }
  | { status: 'limited'; retryAfter: number };

interface Actor {
  ownerId: string;
  scopes: string[];
  hash: Buffer;
}

/** Looks up the presented key. A value of the wrong shape (a player token, for one) is refused before the database. */
async function actorFor(deps: OwnerKeyDeps, presented: string): Promise<Actor | null> {
  if (!isOwnerKeyShape(presented)) return null;
  const hash = deps.hash(presented);
  const found = await deps.store.resolve(hash);
  return found === null ? null : { ownerId: found.ownerId, scopes: found.scopes, hash };
}

/** Outcomes the database does not write, so they are audited here. */
const AUDITED = new Set(['scope_missing', 'bad_scopes', 'not_found', 'limited']);

/**
 * Runs one key action: the scope check, the scope validation, the window (skipped for an admin and for
 * a read) and the database call. A database error is audited and rethrown, so no value is returned.
 */
async function act(
  deps: OwnerKeyDeps,
  actor: Actor,
  options: {
    action: string;
    target: string;
    required: OwnerKeyScope;
    windowed: boolean;
    invalid?: boolean;
  },
  run: () => Promise<OwnerKeyResult>,
): Promise<OwnerKeyResult> {
  const admin = await deps.isAdmin(actor.ownerId);
  let result: OwnerKeyResult;
  try {
    if (!hasScope(actor.scopes, options.required)) {
      result = { status: 'scope_missing' };
    } else if (options.invalid) {
      result = { status: 'bad_scopes' };
    } else {
      const wait = options.windowed && !admin ? deps.charge(actor.ownerId) : 0;
      result = wait > 0 ? { status: 'limited', retryAfter: wait } : await run();
    }
  } catch (error) {
    await deps
      .audit({
        ownerId: actor.ownerId,
        action: options.action,
        target: options.target,
        outcome: 'error',
        admin,
      })
      .catch(() => undefined);
    throw error;
  }
  if (AUDITED.has(result.status)) {
    await deps.audit({
      ownerId: actor.ownerId,
      action: options.action,
      target: options.target,
      outcome: result.status,
      admin,
    });
  }
  return result;
}

/** Mints a key with the requested scopes, each of which the presented key must hold. Needs manage. */
export async function mintOwnerKey(
  deps: OwnerKeyDeps,
  presented: string,
  requested: readonly string[],
): Promise<OwnerKeyResult> {
  const actor = await actorFor(deps, presented);
  if (actor === null) return { status: 'refused' };
  const scopes = parseScopes(requested);
  const invalid = scopes === null || scopes.some((s) => !actor.scopes.includes(s));
  return act(
    deps,
    actor,
    { action: 'key.mint', target: '', required: 'manage', windowed: true, invalid },
    async () => {
      const fresh = deps.issue();
      const expiresAt = await deps.store.mint(
        actor.hash,
        fresh.keyId,
        deps.hash(fresh.value),
        scopes ?? [],
      );
      if (expiresAt === null) return { status: 'refused' };
      return {
        status: 'minted',
        keyId: fresh.keyId,
        value: fresh.value,
        scopes: scopes ?? [],
        expiresAt,
      };
    },
  );
}

/** Revokes one key of the presenter's owner. Needs manage; another owner's key is not found. */
export async function revokeOwnerKey(
  deps: OwnerKeyDeps,
  presented: string,
  keyId: string,
): Promise<OwnerKeyResult> {
  const actor = await actorFor(deps, presented);
  if (actor === null) return { status: 'refused' };
  return act(
    deps,
    actor,
    { action: 'key.revoke', target: keyId, required: 'manage', windowed: true },
    async () => {
      const changed = await deps.store.revoke(actor.hash, keyId);
      if (changed === null) return { status: 'refused' };
      return changed ? { status: 'revoked' } : { status: 'not_found' };
    },
  );
}

/** Lists the presenter's owner's keys. Needs read. A read is not windowed. */
export async function listOwnerKeys(
  deps: OwnerKeyDeps,
  presented: string,
): Promise<OwnerKeyResult> {
  const actor = await actorFor(deps, presented);
  if (actor === null) return { status: 'refused' };
  return act(
    deps,
    actor,
    { action: 'key.list', target: '', required: 'read', windowed: false },
    async () => {
      const keys = await deps.store.list(actor.hash);
      return keys === null ? { status: 'refused' } : { status: 'listed', keys };
    },
  );
}
