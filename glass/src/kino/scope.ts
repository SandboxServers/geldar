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

/** The SELECT-only store behind `geldar_glass`. Reads through the definer functions kino_viewer and kino_agent_scope (0017): geldar_glass has no grant on mcp_identities or agents.owner. */
export function sqlScopeStore(db: SqlClient): ScopeStore {
  return {
    async access(identityHash) {
      if (identityHash === null) return ANONYMOUS;
      const who = await db.query(
        `SELECT v.owner_id, v.banned, v.admin FROM kino_viewer(decode($1, 'hex')) v`,
        [identityHash],
      );
      const row = who.rows[0];
      return {
        signedIn: true,
        admin: row !== undefined && row.admin === true,
        ownerId: row === undefined || row.owner_id === null ? null : String(row.owner_id),
        banned: row !== undefined && row.banned === true,
      };
    },
    async agent(agentId) {
      // kino_agent_scope(NULL) answers for every agent: never call it for a missing or empty id.
      if (typeof agentId !== 'string' || agentId.trim() === '') return null;
      const r = await db.query(`SELECT s.owner, s.public_camera FROM kino_agent_scope($1) s`, [
        agentId,
      ]);
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
        publicCamera: row.public_camera === true,
      };
    },
  };
}

/** Every agent with its scope, for the target picker. SELECT only, like the store above. */
export async function listAgents(db: SqlClient): Promise<Array<AgentScope & { id: string }>> {
  const r = await db.query(
    `SELECT s.agent_id, s.owner, s.public_camera FROM kino_agent_list() s ORDER BY s.agent_id`,
    [],
  );
  return r.rows.map((row) => ({
    id: String(row.agent_id),
    owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
    publicCamera: row.public_camera === true,
  }));
}

/** The agent ids this viewer may watch: the same rule as a subscribe, so the picker never offers a refusal. */
export function watchableIds(
  access: Access,
  agents: ReadonlyArray<AgentScope & { id: string }>,
): string[] {
  return agents.filter((a) => permitted(access, a)).map((a) => a.id);
}
