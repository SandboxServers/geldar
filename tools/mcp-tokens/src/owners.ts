/** A row as the pg driver returns it. */
export type Row = Record<string, unknown>;

/** The one query surface every command uses; a pg Client satisfies it, and tests pass a fake. */
export interface Sql {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

/** The largest cap an owner can hold (decision 0052; the table's CHECK agrees). */
export const MAX_OWNER_CAP = 50;

/** The cap an owner gets when `owner add` names none (spec 5.15.6). */
export const DEFAULT_OWNER_CAP = 3;

const OWNER_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Owner ids are short lower-case slugs; the owner's own name stays in the database, not in git. */
export function checkOwnerId(id: string): void {
  if (!OWNER_ID.test(id))
    throw new Error('owner id must be 1 to 63 lower-case letters, digits or dashes');
}

/** A cap is a whole number from 0 to MAX_OWNER_CAP. */
export function checkCap(cap: number): void {
  if (!Number.isInteger(cap) || cap < 0 || cap > MAX_OWNER_CAP) {
    throw new Error(`a cap is a whole number from 0 to ${MAX_OWNER_CAP}`);
  }
}

/** Parses a --cap value; anything but a plain decimal number is refused before the database sees it. */
export function parseCap(text: string): number {
  if (!/^[0-9]{1,2}$/.test(text))
    throw new Error(`a cap is a whole number from 0 to ${MAX_OWNER_CAP}`);
  const cap = Number(text);
  checkCap(cap);
  return cap;
}

export async function addOwner(
  sql: Sql,
  id: string,
  cap: number = DEFAULT_OWNER_CAP,
): Promise<void> {
  checkOwnerId(id);
  checkCap(cap);
  await sql.query('INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ($1, $1, $2)', [
    id,
    cap,
  ]);
}

export async function setOwnerCap(sql: Sql, id: string, cap: number): Promise<void> {
  checkOwnerId(id);
  checkCap(cap);
  const result = await sql.query(
    'UPDATE mcp_owners SET player_cap = $2 WHERE owner_id = $1 RETURNING owner_id',
    [id, cap],
  );
  if (result.rows.length === 0) throw new Error(`no owner ${id}`);
}
