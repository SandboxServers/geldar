/**
 * The Kino viewer behind the gk_session cookie that the register service signs (R42). Glass only
 * reads: it verifies the cookie with the shared key file and looks the identity up in kino_admins
 * and agents.public_camera through its read-only role. It never sets, extends or clears the cookie.
 */
import { kinoSessionFromHeader } from './kino-cookie.ts';
import type { SqlClient } from './query.ts';

export interface KinoViewer {
  signedIn: boolean;
  admin: boolean;
  /** The agents whose owners switched the public camera on. Everyone may see this list. */
  publicCameras: string[];
}

/** Resolves a request's Cookie header to a viewer. A missing, forged, malformed or expired cookie is a signed-out viewer. */
export async function resolveViewer(
  db: SqlClient,
  key: string | undefined,
  cookieHeader: string | undefined,
  nowMs: number,
): Promise<KinoViewer> {
  const cams = await db.query(
    `SELECT a.agent_id FROM agents a WHERE a.public_camera ORDER BY a.agent_id LIMIT 500`,
    [],
  );
  const publicCameras = cams.rows.map((r) => String(r.agent_id));
  const session = key === undefined ? null : kinoSessionFromHeader(key, cookieHeader, nowMs);
  if (session === null) return { signedIn: false, admin: false, publicCameras };
  const found = await db.query(
    `SELECT 1 AS ok FROM kino_admins k WHERE k.identity_hash = decode($1, 'hex')`,
    [session.identityHash],
  );
  return { signedIn: true, admin: found.rows.length > 0, publicCameras };
}
