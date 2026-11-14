import { type FlagQuery, isAdminOwner } from './admin.ts';
import type { ApiDeps } from './api/route.ts';
import { writeAudit } from './audit.ts';
import { ownerAgentLoaders } from './owner-agents-pg.ts';
import { OwnerKeyPgStore } from './owner-keys-pg.ts';
import { hashOwnerKey, newOwnerKey } from './owner-keys-policy.ts';
import type { Store } from './store.ts';

/** The fixed log code for an audit row that could not be written. The error text is never logged. */
export const AUDIT_LOST_CODE = 'audit_lost';

export interface ProductionApiOptions {
  /** The geldar_register pool (or a client of it): the definer functions and the audit table go through it. */
  readonly db: FlagQuery;
  /** Owner lookup by identity hash (hex) for a cookie session. */
  readonly store: Store;
  /** The token pepper: owner keys are HMAC-hashed under it, as the MCP side hashes tokens. */
  readonly tokenPepper: string;
  /** Log lines carry the fixed code and a counter only. */
  readonly log: (line: string) => void;
}

/**
 * The production owner API wiring (C7-04b-5): the Postgres owner-key store, the admin flag through
 * register_is_admin (fails closed), the audit writer, the audit-lost counter and the cookie-session
 * owner lookup, and the agent loaders over the migration 0036 functions (keyed by owner id).
 */
export function productionApi(
  options: ProductionApiOptions,
): Pick<
  ApiDeps,
  'isAdmin' | 'ownerKeys' | 'ownerKeySessions' | 'agents' | 'listAgents' | 'audit' | 'onAuditLost'
> {
  const { db, store, log } = options;
  const keys = new OwnerKeyPgStore(db);
  const hash = (value: string) => hashOwnerKey(options.tokenPepper, value);
  const isAdmin = (ownerId: string) => isAdminOwner(db, ownerId);
  const audit = (entry: { ownerId: string; action: string; target: string; outcome: string }) =>
    writeAudit(db, {
      actor: entry.ownerId,
      actorOwner: entry.ownerId,
      action: entry.action,
      target: entry.target,
      outcome: entry.outcome,
    });
  let lost = 0;
  return {
    isAdmin,
    ...ownerAgentLoaders(db),
    ownerKeys: { store: keys, hash },
    ownerKeySessions: {
      session: keys,
      isAdmin,
      // The router charges every write once through its own window; this charge is not used.
      charge: () => 0,
      hash,
      issue: newOwnerKey,
      audit,
      now: () => new Date(),
      resolveOwner: async (identityHash) => {
        const owner = await store.findOwner(identityHash.toString('hex'));
        return owner === null ? null : { ownerId: owner.ownerId, banned: owner.banned };
      },
    },
    audit,
    onAuditLost: () => {
      lost += 1;
      log(`${AUDIT_LOST_CODE} count=${lost}`);
    },
  };
}
