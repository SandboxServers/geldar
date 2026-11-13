/** The one query the admin reader needs; a pg Pool or Client satisfies it, and tests pass a fake. */
export interface FlagQuery {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Whether an owner holds the admin flag (decision 0170, C7-12). Only the flagged owner reads true.
 * It fails closed: an unknown owner, a missing or non-true value, and a query error all give false,
 * so an error can never grant an exemption. The flag is read through register_is_admin (0025).
 */
export async function isAdminOwner(db: FlagQuery, ownerId: string): Promise<boolean> {
  try {
    const result = await db.query('SELECT register_is_admin($1) AS admin', [ownerId]);
    return result.rows[0]?.admin === true;
  } catch {
    return false;
  }
}
