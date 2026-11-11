/**
 * The HTTP handler: security headers on every response, the route table, the query parameters, and
 * the JSON bodies. Agent-authored text leaves as JSON data; the page (a later packet) escapes it.
 */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { clientAddress } from './guard.ts';
import { OPEN_POLICY, type PublicPolicy } from './policy.ts';
import {
  getThought,
  listAgents,
  listReceipts,
  listThoughts,
  type Row,
  type SqlClient,
  type ThoughtCursor,
  type ThoughtFilter,
} from './query.ts';
import { resolveRoute } from './routes.ts';
import type { SseHub } from './sse.ts';

/** The largest model input a thought detail returns, in bytes (wave 6 item 10, Glass design). */
export const MODEL_INPUT_CAP_BYTES = 64 * 1024;

/** Headers on every response, the API and the stream alike, including 404 and 405. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

interface StaticFile {
  body: string;
  type: string;
}

const JS = 'text/javascript; charset=utf-8';
const PUBLIC = new URL('../public/', import.meta.url);
const SOURCE = new URL('./', import.meta.url);

/** Reads one page file at load. The browser gets the render modules as JavaScript, types stripped. */
function staticFile(dir: URL, name: string, type: string, strip = false): StaticFile {
  const raw = readFileSync(new URL(name, dir), 'utf8');
  return { body: strip ? stripTypeScriptTypes(raw) : raw, type };
}

/**
 * The page and its scripts, keyed by URL path. A request selects an entry here; no path from the
 * request names a file. Writes to these paths get 405.
 */
const STATIC_FILES: ReadonlyMap<string, StaticFile> = new Map([
  ['/', staticFile(PUBLIC, 'index.html', 'text/html; charset=utf-8')],
  ['/app.css', staticFile(PUBLIC, 'app.css', 'text/css; charset=utf-8')],
  ['/app.js', staticFile(PUBLIC, 'app.js', JS)],
  ['/js/render-model.ts', staticFile(SOURCE, 'render-model.ts', JS, true)],
  ['/js/render-view.ts', staticFile(SOURCE, 'render-view.ts', JS, true)],
  ['/js/render-stream.ts', staticFile(SOURCE, 'render-stream.ts', JS, true)],
]);

/** The path of a request target, or an empty string when it does not parse. */
function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://glass.invalid').pathname;
  } catch {
    return '';
  }
}

export interface GlassHandlerDeps {
  db: SqlClient;
  hub: SseHub;
  /** The public guards. Left out, the handler admits every request (no rate limit). */
  policy?: Partial<PublicPolicy>;
}

export interface CappedText {
  json: string;
  bytes: number;
  truncated: boolean;
}

/** Caps model input at 64 KiB. The byte count is the whole input's, so a reader can see the cut. */
export function capModelInput(value: unknown): CappedText | null {
  if (typeof value !== 'string') return null;
  const whole = Buffer.from(value, 'utf8');
  if (whole.length <= MODEL_INPUT_CAP_BYTES) {
    return { json: value, bytes: whole.length, truncated: false };
  }
  const head = whole.subarray(0, MODEL_INPUT_CAP_BYTES).toString('utf8');
  return { json: head, bytes: whole.length, truncated: true };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Reads a query value with a length cap. Absent or empty means undefined. */
function textParam(query: URLSearchParams, name: string, max: number): string | undefined {
  const value = query.get(name);
  if (value === null || value === '') return undefined;
  if (value.length > max) throw new BadRequest(`${name} is longer than ${max} characters`);
  return value;
}

class BadRequest extends Error {}

/** The thought-list cursor is base64url of "<at>\n<thought_id>". A bad cursor is a 400. */
function decodeCursor(raw: string): ThoughtCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const cut = text.indexOf('\n');
  const at = cut < 0 ? '' : text.slice(0, cut);
  if (cut < 0 || Number.isNaN(Date.parse(at))) throw new BadRequest('cursor is not valid');
  return { at, id: text.slice(cut + 1) };
}

/** Builds the thought-list filter from the query string. Every value is validated here. */
function thoughtFilter(query: URLSearchParams): ThoughtFilter {
  const outcome = textParam(query, 'outcome', 16);
  if (outcome !== undefined && outcome !== 'parsed' && outcome !== 'unparsed') {
    throw new BadRequest('outcome must be parsed or unparsed');
  }
  const since = textParam(query, 'since', 40);
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new BadRequest('since must be an ISO time');
  }
  const limitRaw = textParam(query, 'limit', 4) ?? '50';
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequest('limit must be 1 to 100');
  }
  const cursor = textParam(query, 'cursor', 512);
  return {
    lifeId: textParam(query, 'agent', 128),
    tier: textParam(query, 'tier', 64),
    outcome: outcome as ThoughtFilter['outcome'],
    since: since === undefined ? undefined : new Date(since).toISOString(),
    before: cursor === undefined ? undefined : decodeCursor(cursor),
    limit,
  };
}

/**
 * The cursor for the next page: the last row's time (as Postgres text, to the microsecond) and id,
 * or null when the page is not full.
 */
function nextCursor(rows: Row[], limit: number): string | null {
  const last = rows[rows.length - 1];
  if (rows.length < limit || last === undefined) return null;
  return Buffer.from(`${String(last.cursor_at)}\n${String(last.thought_id)}`, 'utf8').toString(
    'base64url',
  );
}

/** Drops the cursor column: it exists for the next page, not for the reader. */
function publicRows(rows: Row[]): Row[] {
  return rows.map(({ cursor_at: _cursor, ...row }) => row);
}

async function serveRoute(
  name: string,
  params: Record<string, string>,
  query: URLSearchParams,
  res: ServerResponse,
  deps: GlassHandlerDeps,
): Promise<void> {
  if (name === 'agents') {
    sendJson(res, 200, { agents: await listAgents(deps.db) });
    return;
  }
  if (name === 'thoughts') {
    const filter = thoughtFilter(query);
    const thoughts = await listThoughts(deps.db, filter);
    sendJson(res, 200, {
      thoughts: publicRows(thoughts),
      next: nextCursor(thoughts, filter.limit),
    });
    return;
  }
  if (name === 'thought') {
    const row = await getThought(deps.db, params.id ?? '');
    if (row === null) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    sendJson(res, 200, { thought: { ...row, model_input: capModelInput(row.model_input) } });
    return;
  }
  if (name === 'receipts') {
    const actionId = textParam(query, 'action_id', 128);
    if (actionId === undefined) throw new BadRequest('action_id is required');
    sendJson(res, 200, { receipts: await listReceipts(deps.db, actionId) });
    return;
  }
  if (name === 'stats') {
    sendJson(res, 200, { stats: deps.hub.stats() });
    return;
  }
  if (!deps.hub.attach(res)) sendJson(res, 503, { error: 'too many streams' });
}

/** The Host values Glass answers to. A name that another site controls is not one of them. */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

/** The request listener. It never sends a database error or a stack trace to the client. */
export function createHandler(deps: GlassHandlerDeps) {
  const policy: PublicPolicy = { ...OPEN_POLICY, ...deps.policy };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // DNS rebinding: a page on another site can name its own host, and then reach this port.
    if (req.headers.host === undefined || !LOOPBACK_HOST.test(req.headers.host)) {
      sendJson(res, 421, { error: 'misdirected request' });
      return;
    }
    if (policy.limiter !== null) {
      const verdict = policy.limiter.take(clientAddress(req, policy.trustedProxies));
      if (!verdict.allowed) {
        res.setHeader('Retry-After', String(verdict.retryAfter));
        sendJson(res, 429, {
          error: { code: 'rate_limited', message: 'Too many requests' },
          retryAfter: verdict.retryAfter,
        });
        return;
      }
    }
    const file = STATIC_FILES.get(pathOf(req.url));
    if (file !== undefined) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
      res.end(file.body);
      return;
    }
    const route = resolveRoute(req.method, req.url);
    if (route.status === 'not-found') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (route.status === 'method-not-allowed') {
      res.setHeader('Allow', route.allow.join(', '));
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    try {
      await serveRoute(route.name, route.params, route.query, res, deps);
    } catch (err) {
      if (err instanceof BadRequest) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    }
  };
}
