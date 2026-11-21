import type { SkinStatusRow, SkinStore } from './api/skins.ts';
import type { QueryClient } from './owner-keys-pg.ts';

/** The SQLSTATE of the refusals register_skin_submit and register_skin_status raise (migration 0067). */
const NOT_ALLOWED = '42501';

function messageOf(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

function stateOf(err: unknown): string | undefined {
  const state = (err as { code?: unknown } | null)?.code;
  return typeof state === 'string' ? state : undefined;
}

/**
 * The stable refusal code of a register_skin_* error, or null when the error is not one of ours (the caller
 * rethrows it, so the router answers 500 with no message text). The SQLSTATE alone is not enough: 42501 covers
 * three refusals, so the message picks the code, and both must match.
 */
export function skinRefusalCode(err: unknown): string | null {
  const state = stateOf(err);
  const message = messageOf(err);
  if (state === NOT_ALLOWED) {
    if (message.includes('skin_upload_locked')) return 'skin_upload_locked';
    if (message.includes('not your agent')) return 'not_your_agent';
    if (message.includes('not an owner')) return 'not_an_owner';
    return null;
  }
  if (state === '23505' && message.includes('skin_upload_pending')) return 'skin_upload_pending';
  if (state === '55000' && message.includes('skin_upload_wait')) return 'skin_upload_wait';
  if (state === '53400' && message.includes('skin_upload_daily')) return 'skin_upload_daily';
  return null;
}

/** A timestamptz column as ISO text. pg returns a Date; anything else is not a database fact and fails closed. */
function isoOf(value: unknown): string {
  if (!(value instanceof Date)) throw new Error('skin timestamp is not a date');
  return value.toISOString();
}

/** The identity hash is hex text in the store and BYTEA in the database. */
function hashBytes(identityHash: string): Buffer {
  return Buffer.from(identityHash, 'hex');
}

function statusRowOf(row: Record<string, unknown>): SkinStatusRow {
  const reason = row.upload_reason;
  const decided = row.upload_decided;
  return {
    uploadId: Number(row.upload_id),
    status: String(row.upload_status),
    reason: reason === null || reason === undefined ? null : String(reason),
    createdAt: isoOf(row.upload_created),
    decidedAt: decided === null || decided === undefined ? null : isoOf(decided),
  };
}

/**
 * The skin store over migration 0067 (C7-13a). The database raises the refusals; this adapter only converts
 * the values and maps the refusal codes. Nothing here reads the PNG back or logs it.
 */
export function skinStoreOf(db: QueryClient): SkinStore {
  return {
    submitSkin: async (identityHash, playerId, png, sha256) => {
      try {
        const result = await db.query('SELECT register_skin_submit($1, $2, $3, $4) AS upload_id', [
          hashBytes(identityHash),
          playerId,
          png,
          sha256,
        ]);
        const id = result.rows[0]?.upload_id;
        if (id === null || id === undefined) throw new Error('register_skin_submit returned no id');
        return { ok: true, uploadId: Number(id) };
      } catch (err) {
        const code = skinRefusalCode(err);
        if (code === null) throw err;
        return { ok: false, code };
      }
    },
    skinStatus: async (identityHash, playerId) => {
      try {
        const result = await db.query('SELECT * FROM register_skin_status($1, $2)', [
          hashBytes(identityHash),
          playerId,
        ]);
        const row = result.rows[0];
        return { ok: true, row: row === undefined ? null : statusRowOf(row) };
      } catch (err) {
        const code = skinRefusalCode(err);
        if (code === null) throw err;
        return { ok: false, code };
      }
    },
  };
}
