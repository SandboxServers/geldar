import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AuthResult, TokenTable } from './auth.ts';
import { checkBearer } from './auth.ts';

/** Why a player's sessions ended while requests were open. Each value is a fixed template. */
export type SessionEndReason = 'session_revoked';

/** The answer of the `authenticate` hook: a bearer outcome, or a refusal with a retry hint. */
export type AuthDecision = { outcome: AuthResult } | { outcome: 'limited'; retryAfterSec: number };

/** A POST the `onToolCall` hook refuses: its status, a fixed message and an optional retry hint. */
export interface Refusal {
  status: number;
  message: string;
  retryAfterSec?: number;
}

export interface MockHttpOptions {
  tokens: TokenTable;
  /** Builds the MCP server for one new session. `signal` aborts when the session ends or is superseded. */
  createSession: (playerId: string, signal: AbortSignal) => McpServer;
  /** One call per request outcome. Default: a JSON line on stderr. */
  log?: (line: Record<string, unknown>) => void;
  /** Replaces the bearer check of `tokens`. Runs after the Host and Origin checks, before the body is read. */
  authenticate?: (
    playerId: string,
    header: string | undefined,
    req: IncomingMessage,
  ) => Promise<AuthDecision>;
  /** Accepts or refuses a `Host` header (403 when refused). Default: every Host is accepted. */
  hostAllowed?: (host: string | undefined) => boolean;
  /** Largest POST body in bytes (413 above it). Default 1 MiB. */
  maxBodyBytes?: number;
  /** Sees every parsed POST body before it is dispatched; a refusal is sent instead. */
  onToolCall?: (playerId: string, body: unknown, res: ServerResponse) => Refusal | undefined;
  /** Server limits. An unset one keeps Node's default. */
  limits?: { maxConnections?: number; headersTimeoutMs?: number; requestTimeoutMs?: number };
}

export interface MockHttp {
  /** Default host 127.0.0.1. Resolves to the bound port. */
  listen(port: number, host?: string): Promise<number>;
  /** Closes sessions and the listener, then connections. */
  close(): Promise<void>;
  /** Live sessions for the player: 1 while it has one, else 0 (a player never has more than one). */
  sessionCount(playerId: string): number;
  /** Ends the player's session and tells each open request of the player why, then closes them. */
  endPlayerSessions(playerId: string, reason: SessionEndReason): Promise<void>;
}

const PATH = /^\/p\/([a-z][a-z0-9-]{1,38})$/;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SUPERSEDED_IDS = 100;
const DRAIN_MS = 1000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

interface Session {
  id: string | undefined;
  playerId: string;
  transport: StreamableHTTPServerTransport;
  mcp: McpServer;
  controller: AbortController;
  inflight: number;
  idle: (() => void) | undefined;
  ended: boolean;
}

/** What the per-request log line reports; `handle` fills it in as the request progresses. */
interface LogContext {
  event: string;
  playerId: string | undefined;
  error: string | undefined;
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume(); // discard the rest so the client can read the 413
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function hostAllowed(origin: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Creates the per-player bearer-authenticated, one-session-per-player MCP HTTP server. */
export function createMockHttp(options: MockHttpOptions): MockHttp {
  const log =
    options.log ??
    ((line: Record<string, unknown>) => process.stderr.write(`${JSON.stringify(line)}\n`));
  const sessions = new Map<string, Session>();
  const byPlayer = new Map<string, Session>();
  // Superseded session id -> owning player, so only the owner is told "superseded".
  const superseded = new Map<string, string>();
  // Per player, the tail of the chain that serialises session starts.
  const starting = new Map<string, Promise<unknown>>();
  // Set once close() begins, so an initialize still in flight cannot start a session after it.
  let closing = false;
  // Per player, the requests still open, so a revoke can end them.
  const openResponses = new Map<string, Set<ServerResponse>>();

  function rememberSuperseded(id: string, playerId: string): void {
    superseded.set(id, playerId);
    if (superseded.size > MAX_SUPERSEDED_IDS) {
      const oldest = superseded.keys().next().value;
      if (oldest !== undefined) superseded.delete(oldest);
    }
  }

  function forget(session: Session): void {
    if (session.id !== undefined && sessions.get(session.id) === session)
      sessions.delete(session.id);
    if (byPlayer.get(session.playerId) === session) byPlayer.delete(session.playerId);
  }

  function waitIdle(session: Session): Promise<void> {
    if (session.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, DRAIN_MS);
      session.idle = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** Aborts the session's signal, lets in-flight requests return (at most 1 s), then closes it. */
  async function endSession(session: Session): Promise<void> {
    if (session.ended) return;
    session.ended = true;
    forget(session);
    session.controller.abort();
    await waitIdle(session);
    await session.mcp.close().catch(() => undefined);
  }

  /**
   * Starts sessions one at a time per player, so two simultaneous initializes cannot both
   * read the same `previous` and leave two live sessions.
   * Sessions are only ever ended by a newer initialize, a DELETE or close(): a client that
   * drops without DELETE keeps its session until the player's next initialize supersedes it.
   */
  async function startSession(
    playerId: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const turn = (starting.get(playerId) ?? Promise.resolve()).then(() => prepareSession(playerId));
    starting.set(
      playerId,
      turn.catch(() => undefined),
    );
    const session = await turn;
    await dispatch(session, req, res, body);
  }

  async function prepareSession(playerId: string): Promise<Session> {
    if (closing) throw new Error('server is closing');
    const previous = byPlayer.get(playerId);
    if (previous !== undefined) {
      if (previous.id !== undefined) rememberSuperseded(previous.id, playerId);
      await endSession(previous);
      if (closing) throw new Error('server is closing');
    }
    const controller = new AbortController();
    const session: Session = {
      id: undefined,
      playerId,
      controller,
      inflight: 0,
      idle: undefined,
      ended: false,
      mcp: options.createSession(playerId, controller.signal),
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          session.id = id;
          // A newer initialize may have ended this session before its id was issued.
          if (!session.ended) sessions.set(id, session);
        },
      }),
    };
    byPlayer.set(playerId, session);
    session.transport.onclose = () => {
      session.ended = true;
      controller.abort();
      forget(session);
    };
    try {
      await session.mcp.connect(session.transport);
    } catch (error) {
      // Do not leave a half-registered session behind for the player's next initialize.
      await endSession(session);
      throw error;
    }
    return session;
  }

  async function dispatch(
    session: Session,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    // Only POSTs count: a GET is the long-lived notification stream and ends with the session.
    if (req.method === 'POST') {
      session.inflight += 1;
      res.on('close', () => {
        session.inflight -= 1;
        if (session.inflight === 0) session.idle?.();
      });
    }
    await session.transport.handleRequest(req, res, body);
  }

  /** Remembers the request until it closes, so `endPlayerSessions` can end it. */
  function trackResponse(player: string, res: ServerResponse): void {
    const open = openResponses.get(player) ?? new Set<ServerResponse>();
    openResponses.set(player, open);
    open.add(res);
    res.on('close', () => {
      open.delete(res);
      if (open.size === 0 && openResponses.get(player) === open) openResponses.delete(player);
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, ctx: LogContext): Promise<void> {
    res.on('close', () => {
      log({
        event: ctx.event,
        ...(ctx.playerId !== undefined ? { player_id: ctx.playerId } : {}),
        status: res.statusCode,
        ...(ctx.error !== undefined ? { error: ctx.error } : {}),
      });
    });

    const path = (req.url ?? '').split('?')[0] ?? '';
    const match = PATH.exec(path);
    if (match?.[1] === undefined) {
      ctx.event = 'not_found';
      res.writeHead(404).end();
      return;
    }
    const player = match[1];
    ctx.playerId = player;
    trackResponse(player, res);

    if (options.hostAllowed !== undefined && !options.hostAllowed(req.headers.host)) {
      ctx.event = 'host_rejected';
      res.writeHead(403).end();
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined && !hostAllowed(origin)) {
      ctx.event = 'origin_rejected';
      res.writeHead(403).end();
      return;
    }

    const authHeader = req.headers.authorization;
    const decision: AuthDecision =
      options.authenticate !== undefined
        ? await options.authenticate(player, authHeader, req)
        : { outcome: checkBearer(options.tokens, player, authHeader) };
    if ('retryAfterSec' in decision) {
      ctx.event = 'rate_limited';
      res.writeHead(429, { 'Retry-After': String(decision.retryAfterSec) }).end();
      return;
    }
    if (decision.outcome === 'unauthorized') {
      ctx.event = 'unauthorized';
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
      return;
    }
    if (decision.outcome === 'forbidden') {
      ctx.event = 'forbidden';
      res.writeHead(403).end();
      return;
    }

    const method = req.method ?? '';
    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      ctx.event = 'method_not_allowed';
      res.writeHead(405, { Allow: 'POST, GET, DELETE' }).end();
      return;
    }

    let parsed: unknown;
    if (method === 'POST') {
      const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
      const declared = Number(req.headers['content-length']);
      let raw: string | undefined;
      if (!(declared > limit)) {
        try {
          raw = await readBody(req, limit);
        } catch (error) {
          if (!(error instanceof BodyTooLarge)) throw error;
        }
      }
      if (raw === undefined) {
        ctx.event = 'body_too_large';
        const cut = setTimeout(() => req.destroy(), 2000);
        cut.unref();
        req.on('close', () => clearTimeout(cut));
        res.writeHead(413, { Connection: 'close' }).end();
        return;
      }
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.event = 'parse_error';
        rpcError(res, 400, -32700, 'Parse error');
        return;
      }
      const refusal = options.onToolCall?.(player, parsed, res);
      if (refusal !== undefined) {
        ctx.event = 'refused';
        ctx.error = refusal.message;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (refusal.retryAfterSec !== undefined) {
          headers['Retry-After'] = String(refusal.retryAfterSec);
        }
        res.writeHead(refusal.status, headers);
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32003, message: refusal.message },
            id: null,
          }),
        );
        return;
      }
      if (isInitializeRequest(parsed)) {
        ctx.event = 'initialize';
        await startSession(player, req, res, parsed);
        return;
      }
    }

    const header = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (sessionId === undefined) {
      ctx.event = 'missing_session';
      rpcError(res, 400, -32000, 'missing_session');
      return;
    }
    if (superseded.get(sessionId) === player) {
      ctx.event = 'session_superseded';
      rpcError(res, 404, -32001, 'session_superseded');
      return;
    }
    const session = sessions.get(sessionId);
    if (session === undefined || session.playerId !== player) {
      ctx.event = 'session_not_found';
      rpcError(res, 404, -32001, 'session_not_found');
      return;
    }
    if (method === 'DELETE') {
      ctx.event = 'session_deleted';
      await endSession(session);
      res.writeHead(200).end();
      return;
    }
    ctx.event = 'session_request';
    await dispatch(session, req, res, parsed);
  }

  const server = createServer((req, res) => {
    const ctx: LogContext = { event: 'request', playerId: undefined, error: undefined };
    handle(req, res, ctx).catch((error: unknown) => {
      // Class and message only: never the request or its headers.
      ctx.event = 'internal_error';
      ctx.error =
        error instanceof Error ? `${error.constructor.name}: ${error.message}` : 'non-Error thrown';
      // The close hook already logged if the client left first, so log the cause here.
      if (res.closed) {
        log({
          event: ctx.event,
          ...(ctx.playerId !== undefined ? { player_id: ctx.playerId } : {}),
          status: res.statusCode,
          error: ctx.error,
        });
        return;
      }
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  if (options.limits?.maxConnections !== undefined) {
    server.maxConnections = options.limits.maxConnections;
  }
  if (options.limits?.headersTimeoutMs !== undefined) {
    server.headersTimeout = options.limits.headersTimeoutMs;
  }
  if (options.limits?.requestTimeoutMs !== undefined) {
    server.requestTimeout = options.limits.requestTimeoutMs;
  }

  return {
    async endPlayerSessions(playerId, reason) {
      const frame = JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32002, message: reason },
        id: null,
      });
      for (const res of [...(openResponses.get(playerId) ?? [])]) {
        if (!res.headersSent) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.write(frame);
        } else {
          // An open response has sent its headers only as an event stream (the SDK opens SSE
          // before it answers), so the frame goes out as one event.
          res.write(`event: message\ndata: ${frame}\n\n`);
        }
        res.end();
      }
      const session = byPlayer.get(playerId);
      if (session !== undefined) await endSession(session);
    },
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    async close() {
      closing = true;
      const live = new Set([...byPlayer.values(), ...sessions.values()]);
      await Promise.all([...live].map((session) => endSession(session)));
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
    sessionCount(playerId) {
      return byPlayer.has(playerId) ? 1 : 0;
    },
  };
}
