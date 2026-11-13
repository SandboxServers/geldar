import { type FlagQuery, isAdminOwner } from './admin.ts';

/** The longest detail a register_audit row may carry (0025 CHECK). */
export const AUDIT_DETAIL_MAX = 256;

export interface AuditEntry {
  /** An owner id hash, or 'operator'. Never a name or an email. */
  actor: string;
  /** The owner id behind the actor, when the actor is an owner; it decides the admin column only. */
  actorOwner?: string;
  action: string;
  target: string;
  outcome: string;
  detail?: string;
}

/**
 * Appends one row to register_audit (decision 0170, C7-12). admin is true only when the actor is an
 * owner that holds the flag; a missing actor owner, an unflagged one, or a failed lookup writes
 * false. A detail over 256 characters is refused, not truncated, so no row is written.
 */
export async function writeAudit(db: FlagQuery, entry: AuditEntry): Promise<void> {
  const detail = entry.detail ?? '';
  if (detail.length > AUDIT_DETAIL_MAX) {
    throw new Error(`audit detail is over ${AUDIT_DETAIL_MAX} characters`);
  }
  const admin = entry.actorOwner === undefined ? false : await isAdminOwner(db, entry.actorOwner);
  await db.query(
    'INSERT INTO register_audit (actor, action, target, outcome, admin, detail) VALUES ($1, $2, $3, $4, $5, $6)',
    [entry.actor, entry.action, entry.target, entry.outcome, admin, detail],
  );
}
