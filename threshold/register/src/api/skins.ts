import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import { checkSkinPng, SKIN_MAX_BYTES } from '../skin-validate.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/** The result of register_skin_submit: the new upload id, or the stable refusal code the database raised. */
export type SkinSubmitOutcome = { readonly ok: true; readonly uploadId: number } | { readonly ok: false; readonly code: string };

/** One row of register_skin_status: the reason code only, never the image or the decider (decision 0172 point 4). */
export interface SkinStatusRow {
  readonly uploadId: number;
  readonly status: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** The result of register_skin_status: the newest row (null when the agent has no upload), or a refusal code. */
export type SkinStatusOutcome =
  | { readonly ok: true; readonly row: SkinStatusRow | null }
  | { readonly ok: false; readonly code: string };

/** The store methods the skin routes need. */
export interface SkinStore {
  submitSkin(identityHash: string, playerId: string, png: Buffer, sha256: Buffer): Promise<SkinSubmitOutcome>;
  skinStatus(identityHash: string, playerId: string): Promise<SkinStatusOutcome>;
}

/** The skin routes when the store has both methods; none otherwise (the routes are never mounted on a store without them). */
export function mountSkinRoutes(store: Partial<SkinStore>): readonly ApiRoute[] {
  if (typeof store.submitSkin !== 'function' || typeof store.skinStatus !== 'function') return [];
  return skinRoutes(store as SkinStore);
}

/** The Retry-After of a 1 hour reject wait: the wait is 1 hour, so this is the longest it can be (fail closed). */
export const SKIN_REJECT_WAIT_SECONDS = 3600;
/** The Retry-After of the daily cap: the oldest of the 3 uploads leaves the 24 hour window within a day. */
export const SKIN_DAILY_SECONDS = 86400;

const TYPE_DETAIL = 'The skin must be sent as image/png.';
const SIZE_DETAIL = 'The skin image is larger than 32 KiB.';
const REFUSED_DETAIL = 'The skin was refused:';

/**
 * Reads the request body up to max bytes. Returns null as soon as the body is over the cap, without buffering the rest;
 * a declared Content-Length over the cap is refused before any byte is read.
 */
async function readCapped(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > max) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

/** Maps a refused submit to its answer. Errors name no owner id and no bytes; each code is one fixed string. */
function sendSubmitRefusal(res: ServerResponse, code: string): void {
  switch (code) {
    case 'skin_upload_pending':
      sendProblem(res, 'conflict', {}, 'An upload for this agent is still pending.');
      return;
    case 'skin_upload_locked':
      sendProblem(res, 'conflict', {}, 'Uploads are paused until the operator reviews the rejected skins.');
      return;
    case 'skin_upload_wait':
      sendProblem(res, 'rate_limited', { 'retry-after': String(SKIN_REJECT_WAIT_SECONDS) });
      return;
    case 'skin_upload_daily':
      sendProblem(res, 'rate_limited', { 'retry-after': String(SKIN_DAILY_SECONDS) });
      return;
    case 'not_your_agent':
      sendProblem(res, 'not_found');
      return;
    case 'not_an_owner':
      sendProblem(res, 'unauthenticated');
      return;
    default:
      sendProblem(res, 'internal');
  }
}

function sendJson(ctx: ApiContext, status: number, body: unknown): void {
  ctx.res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  });
  ctx.res.end(JSON.stringify(body));
}

/**
 * POST /agents/{playerId}/skin and GET /agents/{playerId}/skin (C7-13a, decision 0172). Cookie session only with CSRF
 * for the write (bearer keys are refused at a cookie-only route). The body is one raw image/png, at most 32 KiB, read
 * with the cap before it is buffered. The validator runs first; the database then checks ownership, the rate rules and
 * stores the row as `pending`. Nothing is approved, sent to MineSkin, or written to the world.
 */
export function skinRoutes(store: SkinStore): readonly ApiRoute[] {
  return [
    {
      method: 'POST',
      pattern: /^\/agents\/([^/]+)\/skin$/,
      scope: 'manage',
      write: true,
      cookieOnly: true,
      async handler(ctx) {
        const playerId = ctx.params[0] ?? '';
        if (ctx.identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
        const type = String(ctx.req.headers['content-type'] ?? '');
        if (type.split(';')[0]?.trim().toLowerCase() !== 'image/png') {
          return sendProblem(ctx.res, 'invalid', {}, TYPE_DETAIL);
        }
        const png = await readCapped(ctx.req, SKIN_MAX_BYTES);
        if (png === null) return sendProblem(ctx.res, 'invalid', { connection: 'close' }, SIZE_DETAIL);
        const check = checkSkinPng(png);
        if (!check.ok) return sendProblem(ctx.res, 'invalid', {}, `${REFUSED_DETAIL} ${check.code}`);
        const sha256 = createHash('sha256').update(png).digest();
        const out = await store.submitSkin(ctx.identityHash, playerId, png, sha256);
        if (!out.ok) return sendSubmitRefusal(ctx.res, out.code);
        sendJson(ctx, 202, { uploadId: out.uploadId, status: 'pending' });
      },
    },
    {
      method: 'GET',
      pattern: /^\/agents\/([^/]+)\/skin$/,
      scope: 'read',
      write: false,
      cookieOnly: true,
      async handler(ctx) {
        const playerId = ctx.params[0] ?? '';
        if (ctx.identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
        const out = await store.skinStatus(ctx.identityHash, playerId);
        if (!out.ok) return sendSubmitRefusal(ctx.res, out.code);
        const row = out.row;
        if (row === null) return sendJson(ctx, 200, { status: 'none' });
        sendJson(ctx, 200, {
          uploadId: row.uploadId,
          status: row.status,
          reason: row.reason,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
        });
      },
    },
  ];
}
