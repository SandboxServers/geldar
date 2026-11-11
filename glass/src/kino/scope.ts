/**
 * Who may watch which agent (decisions 0075 and 0135, rulings R34 to R37). A pure rule plus a
 * read-only store. The store sends SELECT only: Glass holds no write path (decision 0072).
 */
import type { SqlClient } from '../query.ts';

export interface Access {
  signedIn: boolean;
  admin: boolean;
  /** The owner behind the identity, or null for an anonymous viewer or an unknown identity. */
  ownerId: string | null;
  /** The identity is banned: it watches nothing. */
  banned: boolean;
}

export interface AgentScope {
  owner: string | null;
  publicCamera: boolean;
}

export const ANONYMOUS: Access = { signedIn: false, admin: false, ownerId: null, banned: false };

/** True when the viewer may watch the agent. An unknown agent is `null` and is never permitted. */
export function permitted(access: Access, agent: AgentScope | null): boolean {
  if (agent === null || access.banned) return false;
  if (access.admin) return true;
  if (agent.publicCamera) return true;
  return access.signedIn && access.ownerId !== null && agent.owner === access.ownerId;
}

export interface ScopeStore {
  access(identityHash: string | null): Promise<Access>;
  agent(agentId: string): Promise<AgentScope | null>;
}

/** The SELECT-only store behind `geldar_glass`. Needs read grants on mcp_identities and agents.owner. */
export function sqlScopeStore(db: SqlClient): ScopeStore {
  return {
    async access(identityHash) {
      if (identityHash === null) return ANONYMOUS;
      const admin = await db.query(
        `SELECT 1 AS ok FROM kino_admins k WHERE k.identity_hash = decode($1, 'hex')`,
        [identityHash],
      );
      const who = await db.query(
        `SELECT i.owner_id, (i.banned_at IS NOT NULL) AS banned FROM mcp_identities i WHERE i.identity_hash = decode($1, 'hex')`,
        [identityHash],
      );
      const row = who.rows[0];
      return {
        signedIn: true,
        admin: admin.rows.length > 0,
        ownerId: row === undefined ? null : String(row.owner_id),
        banned: row !== undefined && row.banned === true,
      };
    },
    async agent(agentId) {
      const r = await db.query(
        `SELECT a.owner, a.public_camera FROM agents a WHERE a.agent_id = $1`,
        [agentId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
        publicCamera: row.public_camera === true,
      };
    },
  };
}
