import { checkOwnerId, type Sql } from './owners.ts';
import { transaction } from './players.ts';

/** What `owner admin` asks for: set or unset the flag on one owner, or list the flagged owners. */
export type OwnerAdminAction = { verb: 'set' | 'unset'; id: string } | { verb: 'list' };

export const OWNER_ADMIN_USAGE =
  'usage: owner admin set <owner> | owner admin unset <owner> | owner admin list';

/** Reads the words after `owner admin`; anything else is refused with the usage line. */
export function parseOwnerAdmin(args: readonly string[]): OwnerAdminAction {
  const [verb, id, ...extra] = args;
  if (verb === 'list' && id === undefined) return { verb: 'list' };
  if ((verb === 'set' || verb === 'unset') && id !== undefined && extra.length === 0) {
    checkOwnerId(id);
    return { verb, id };
  }
  throw new Error(OWNER_ADMIN_USAGE);
}

/**
 * Sets or clears mcp_owners.is_admin and writes its audit row in one transaction (decision 0170,
 * C7-12). The row's actor is the operator and its admin column is false: the operator is not an
 * owner. An unknown owner is refused before any row is written; a failed audit write rolls the
 * flag change back, so no flag changes without its row.
 */
export async function setOwnerAdmin(sql: Sql, id: string, admin: boolean): Promise<void> {
  checkOwnerId(id);
  await transaction(sql, async () => {
    const result = await sql.query(
      'UPDATE mcp_owners SET is_admin = $2 WHERE owner_id = $1 RETURNING owner_id',
      [id, admin],
    );
    if (result.rows.length === 0) throw new Error(`no owner ${id}`);
    await sql.query(
      'INSERT INTO register_audit (actor, action, target, outcome, admin) VALUES ($1, $2, $3, $4, $5)',
      ['operator', admin ? 'admin_set' : 'admin_unset', id, 'ok', false],
    );
  });
}

/** The owner ids that hold the flag, in order. Reads only; writes no audit row. */
export async function listOwnerAdmins(sql: Sql): Promise<string[]> {
  const result = await sql.query(
    'SELECT owner_id FROM mcp_owners WHERE is_admin ORDER BY owner_id',
    [],
  );
  return result.rows.map((row) => String(row.owner_id));
}

/** Runs one parsed `owner admin` action and returns the lines to print. */
export async function runOwnerAdmin(sql: Sql, action: OwnerAdminAction): Promise<string[]> {
  if (action.verb === 'list') {
    const owners = await listOwnerAdmins(sql);
    return owners.length === 0 ? ['no admin owners'] : owners.map((id) => `admin ${id}`);
  }
  await setOwnerAdmin(sql, action.id, action.verb === 'set');
  return [`owner ${action.id} admin ${action.verb === 'set' ? 'set' : 'unset'}`];
}
