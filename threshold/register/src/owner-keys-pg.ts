import type { OwnerKeyScope } from './owner-keys-policy.ts';
import type { OwnerKeyRow, OwnerKeySessionStore, OwnerKeyStore } from './owner-keys-service.ts';

/** The query surface the adapter needs. A pg.Pool or pg.PoolClient fits it. */
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The problem codes a refused owner-key write maps to (the route turns them into 403 and 409). */
export type KeyDbCode = 'scope_missing' | 'conflict';

/** A write the definer functions refused in SQL. Nothing was written. */
export class KeyDbRefusal extends Error {
  readonly code: KeyDbCode;

  constructor(code: KeyDbCode, sqlstate: string) {
    super(`owner key refused (${sqlstate})`);
    this.code = code;
  }
}

/** SQLSTATE 42501 is a scope escalation or a missing scope; 53400 is the live key cap. Any other error is not ours. */
const SQLSTATE_CODES: Record<string, KeyDbCode> = {
  '42501': 'scope_missing',
  '53400': 'conflict',
};

/** Maps a database error to a refusal, or rethrows it unchanged. */
function refusalOf(error: unknown): never {
  const state = (error as { code?: unknown } | null)?.code;
  const code = typeof state === 'string' ? SQLSTATE_CODES[state] : undefined;
  if (code !== undefined && typeof state === 'string') throw new KeyDbRefusal(code, state);
  throw error;
}

/** Maps one listing row to a key: never the value, never the hash. */
function keyRowOf(row: Record<string, unknown>): OwnerKeyRow {
  return {
    keyId: String(row.key_id),
    scopes: [...(row.scopes as string[])],
    createdAt: row.created_at as Date,
    expiresAt: row.expires_at as Date,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    lastUsedAt: (row.last_used_at as Date | null) ?? null,
  };
}

/**
 * The owner-key store over the register_*_owner_key definer functions (migration 0026, presented key) and the
 * register_session_*_owner_key functions (migration 0035, cookie session identity hash). Each method is one
 * statement, so a failed mint leaves no row. A refused presenter is null (the service maps it to refused).
 */
export class OwnerKeyPgStore implements OwnerKeyStore, OwnerKeySessionStore {
  private readonly client: QueryClient;

  constructor(client: QueryClient) {
    this.client = client;
  }

  async resolve(presenterHash: Buffer): Promise<{ ownerId: string; scopes: string[] } | null> {
    const r = await this.client.query(
      'SELECT owner_id, scopes FROM register_owner_key_resolve($1)',
      [presenterHash],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return { ownerId: String(row.owner_id), scopes: [...(row.scopes as string[])] };
  }

  async mint(
    presenterHash: Buffer,
    keyId: string,
    keyHash: Buffer,
    scopes: OwnerKeyScope[],
  ): Promise<Date | null> {
    try {
      const r = await this.client.query(
        'SELECT register_mint_owner_key($1, $2, $3, $4) AS expires_at',
        [presenterHash, keyId, keyHash, scopes],
      );
      const at = r.rows[0]?.expires_at;
      return at instanceof Date ? at : null;
    } catch (error) {
      return refusalOf(error);
    }
  }

  async revoke(presenterHash: Buffer, keyId: string): Promise<boolean | null> {
    try {
      const r = await this.client.query('SELECT register_revoke_owner_key($1, $2) AS ok', [
        presenterHash,
        keyId,
      ]);
      const ok = r.rows[0]?.ok;
      return typeof ok === 'boolean' ? ok : null;
    } catch (error) {
      return refusalOf(error);
    }
  }

  /**
   * A successful list always holds the presenter's own key (the list is the presenter owner's keys, and the
   * presenter's key is one of them), so zero rows means the database refused the presenter (no key, revoked,
   * banned owner, or no read). The SQL returns no rows in both cases, so the adapter reads zero rows as null.
   */
  async list(presenterHash: Buffer): Promise<OwnerKeyRow[] | null> {
    const r = await this.client.query('SELECT * FROM register_list_owner_keys($1)', [
      presenterHash,
    ]);
    if (r.rows.length === 0) return null;
    return r.rows.map(keyRowOf);
  }

  /** Session mint (0035): the expiry of the new key, or null when no row came back. A refusal throws KeyDbRefusal. */
  async mintBySession(
    identityHash: Buffer,
    keyId: string,
    keyHash: Buffer,
    scopes: OwnerKeyScope[],
  ): Promise<Date | null> {
    try {
      const r = await this.client.query(
        'SELECT register_session_mint_owner_key($1, $2, $3, $4) AS expires_at',
        [identityHash, keyId, keyHash, scopes],
      );
      const at = r.rows[0]?.expires_at;
      return at instanceof Date ? at : null;
    } catch (error) {
      return refusalOf(error);
    }
  }

  /** Session revoke (0035): true when a live key of the session's owner was revoked, false when not found. */
  async revokeBySession(identityHash: Buffer, keyId: string): Promise<boolean | null> {
    try {
      const r = await this.client.query('SELECT register_session_revoke_owner_key($1, $2) AS ok', [
        identityHash,
        keyId,
      ]);
      const ok = r.rows[0]?.ok;
      return typeof ok === 'boolean' ? ok : null;
    } catch (error) {
      return refusalOf(error);
    }
  }

  /**
   * Session list (0035). The SQL raises 42501 for a banned or unknown identity, and that is thrown as a refusal
   * here. Zero rows is therefore an owner with no keys, never a refusal, so it is an empty successful list.
   */
  async listBySession(identityHash: Buffer): Promise<OwnerKeyRow[]> {
    try {
      const r = await this.client.query('SELECT * FROM register_session_list_owner_keys($1)', [
        identityHash,
      ]);
      return r.rows.map(keyRowOf);
    } catch (error) {
      return refusalOf(error);
    }
  }
}
