import type { OwnerKeyScope } from './owner-keys-policy.ts';
import type { OwnerKeyRow, OwnerKeyStore } from './owner-keys-service.ts';

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

/**
 * The owner-key store over the four register_*_owner_key definer functions (migration 0026). Each method is
 * one statement, so a failed mint leaves no row. A refused presenter is null (the service maps it to refused).
 */
export class OwnerKeyPgStore implements OwnerKeyStore {
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
    return r.rows.map((row) => ({
      keyId: String(row.key_id),
      scopes: [...(row.scopes as string[])],
      createdAt: row.created_at as Date,
      expiresAt: row.expires_at as Date,
      revokedAt: (row.revoked_at as Date | null) ?? null,
      lastUsedAt: (row.last_used_at as Date | null) ?? null,
    }));
  }
}
