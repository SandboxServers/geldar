import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { TokenTable } from './auth.ts';
import { checkBearer } from './auth.ts';

export interface MockHttpOptions {
  tokens: TokenTable;
  /** Builds the MCP server for one new session. `signal` aborts when the session ends or is superseded. */
  createSession: (playerId: string, signal: AbortSignal) => McpServer;
  /** One call per request outcome. Default: a JSON line on stderr. */
  log?: (line: Record<string, unknown>) => void;
}

export interface MockHttp {
  /** Default host 127.0.0.1. Resolves to the bound port. */
  listen(port: number, host?: string): Promise<number>;
  /** Closes sessions and the listener, then connections. */
  close(): Promise<void>;
  sessionCount(playerId: string): number;
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

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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
  const superseded = new Set<string>();

  function rememberSuperseded(id: string): void {
    superseded.add(id);
    if (superseded.size > MAX_SUPERSEDED_IDS) {
      const oldest = superseded.values().next().value;
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

  async function startSession(
    playerId: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const previous = byPlayer.get(playerId);
    if (previous !== undefined) {
      if (previous.id !== undefined) rememberSuperseded(previous.id);
      await endSession(previous);
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
          sessions.set(id, session);
        },
      }),
    };
    byPlayer.set(playerId, session);
    session.transport.onclose = () => {
      session.ended = true;
      controller.abort();
      forget(session);
    };
    await session.mcp.connect(session.transport);
    await dispatch(session, req, res, body);
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

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let event = 'request';
    let playerId: string | undefined;
    res.on('close', () => {
      log({
        event,
        ...(playerId !== undefined ? { player_id: playerId } : {}),
        status: res.statusCode,
      });
    });

    const path = (req.url ?? '').split('?')[0] ?? '';
    const match = PATH.exec(path);
    if (match?.[1] === undefined) {
      event = 'not_found';
      res.writeHead(404).end();
      return;
    }
    const player = match[1];
    playerId = player;

    const origin = req.headers.origin;
    if (origin !== undefined && !hostAllowed(origin)) {
      event = 'origin_rejected';
      res.writeHead(403).end();
      return;
    }

    const auth = checkBearer(options.tokens, player, req.headers.authorization);
    if (auth === 'unauthorized') {
      event = 'unauthorized';
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
      return;
    }
    if (auth === 'forbidden') {
      event = 'forbidden';
      res.writeHead(403).end();
      return;
    }

    const method = req.method ?? '';
    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      event = 'method_not_allowed';
      res.writeHead(405, { Allow: 'POST, GET, DELETE' }).end();
      return;
    }

    let parsed: unknown;
    if (method === 'POST') {
      const declared = Number(req.headers['content-length']);
      let raw: string | undefined;
      if (!(declared > MAX_BODY_BYTES)) {
        try {
          raw = await readBody(req);
        } catch (error) {
          if (!(error instanceof BodyTooLarge)) throw error;
        }
      }
      if (raw === undefined) {
        event = 'body_too_large';
        const cut = setTimeout(() => req.destroy(), 2000);
        cut.unref();
        req.on('close', () => clearTimeout(cut));
        res.writeHead(413, { Connection: 'close' }).end();
        return;
      }
      try {
        parsed = JSON.parse(raw);
      } catch {
        event = 'parse_error';
        rpcError(res, 400, -32700, 'Parse error');
        return;
      }
      if (isInitializeRequest(parsed)) {
        event = 'initialize';
        await startSession(player, req, res, parsed);
        return;
      }
    }

    const header = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (sessionId === undefined) {
      event = 'missing_session';
      rpcError(res, 400, -32000, 'missing_session');
      return;
    }
    if (superseded.has(sessionId)) {
      event = 'session_superseded';
      rpcError(res, 404, -32001, 'session_superseded');
      return;
    }
    const session = sessions.get(sessionId);
    if (session === undefined || session.playerId !== player) {
      event = 'session_not_found';
      rpcError(res, 404, -32001, 'session_not_found');
      return;
    }
    if (method === 'DELETE') {
      event = 'session_deleted';
      await endSession(session);
      res.writeHead(200).end();
      return;
    }
    event = 'session_request';
    await dispatch(session, req, res, parsed);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  return {
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
      await Promise.all([...byPlayer.values()].map((session) => endSession(session)));
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
    sessionCount(playerId) {
      return byPlayer.has(playerId) ? 1 : 0;
    },
  };
}
