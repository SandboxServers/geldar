/**
 * The agents the signed-in viewer owns (decision 0138 rule 1). Glass verifies the gk_session cookie with the
 * shared key and asks the read-only definer function glass_owner_agents; it writes nothing. A signed-out,
 * forged or expired cookie, a banned identity and a database error all give an empty list: the viewer then
 * sees only what the public sees.
 */
import { kinoSessionFromHeader } from './kino-cookie.ts';
import type { SqlClient } from './query.ts';

export async function ownedAgentsOf(
  db: SqlClient,
  key: string | undefined,
  cookieHeader: string | undefined,
  nowMs: number,
): Promise<string[]> {
  if (key === undefined) return [];
  const session = kinoSessionFromHeader(key, cookieHeader, nowMs);
  if (session === null) return [];
  try {
    const result = await db.query(
      `SELECT g AS agent_id FROM glass_owner_agents(decode($1, 'hex')) AS g`,
      [session.identityHash],
    );
    return result.rows.map((r) => String(r.agent_id));
  } catch {
    return [];
  }
}
