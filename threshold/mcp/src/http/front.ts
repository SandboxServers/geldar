import type { IncomingMessage } from 'node:http';
import type { AuthDecision, MockHttp, Refusal } from '@geldar/mcp-mock';
import { createMockHttp } from '@geldar/mcp-mock';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConfig } from '../config.ts';
import type { PlayerRecord, RateLimiter, TokenStore } from '../ports.ts';
import { verifyBearer } from './auth.ts';
import { FrontLimits } from './limits.ts';
import { frontLog } from './log.ts';

export interface FrontDoorOptions {
  http: McpConfig['http'];
  /** The HMAC pepper, read from its file by the caller. Never logged. */
  pepper: Uint8Array;
  store: TokenStore;
  limiter: RateLimiter;
  /** Builds the MCP server for one new session. */
  createSession: (playerId: string, signal: AbortSignal) => McpServer;
  /** Receives each log line after `frontLog` has cut it to safe fields. Default: JSON on stderr. */
  log?: (line: Record<string, string | number>) => void;
  /** Clock in milliseconds. Default Date.now. */
  now?: () => number;
}

export interface FrontDoor {
  /** Listens on the configured bind address. Resolves to the bound port. */
  listen(port?: number): Promise<number>;
  /** Ends the revoke subscription, the player sessions and the listener. */
  close(): Promise<void>;
}

/** The largest POST body the front door reads (413 above it). */
export const BODY_LIMIT_BYTES = 64 * 1024;
const HEADERS_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 128;

function stderrSink(line: Record<string, string | number>): void {
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

/**
 * True when the Host header names an allowed host (the public host or a dev host) and any port
 * it carries is the one the server is bound to. Anything else, or no Host, is refused.
 */
export function hostAccepted(
  allowed: readonly string[],
  port: number,
  host: string | undefined,
): boolean {
  const parts = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec((host ?? '').toLowerCase());
  const name = parts?.[1];
  if (name === undefined || !allowed.includes(name)) return false;
  const given = parts?.[2];
  return given === undefined || Number(given) === port;
}

function isToolCall(body: unknown): boolean {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as { method?: unknown }).method === 'tools/call'
    : false;
}

/**
 * The HTTP front of the real MCP server: bearer auth through the token store, Host and Origin
 * checks, body and batch limits, the call and failed-auth budgets, and revocation.
 */
export function createFrontDoor(options: FrontDoorOptions): FrontDoor {
  const now = options.now ?? Date.now;
  const gates = new FrontLimits(options.limiter);
  // Authenticated requests, so the call hook can read the owner of the player it serves.
  const players = new WeakMap<IncomingMessage, PlayerRecord>();
  let port = options.http.port;

  const mock: MockHttp = createMockHttp({
    // The token store checks bearers; the mock's own table is not used on this path.
    tokens: new Map(),
    createSession: options.createSession,
    log: frontLog(options.log ?? stderrSink),
    maxBodyBytes: BODY_LIMIT_BYTES,
    limits: {
      maxConnections: MAX_CONNECTIONS,
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      requestTimeoutMs: 0,
    },
    hostAllowed: (host) => hostAccepted(options.http.allowedHosts, port, host),
    async authenticate(playerId, header, req): Promise<AuthDecision> {
      // No client of this server sends Origin, so any Origin is refused, valid token or not.
      if (req.headers.origin !== undefined) return { outcome: 'forbidden' };
      const verdict = await verifyBearer(options.store, options.pepper, playerId, header, now());
      if (verdict.outcome === 'ok') {
        players.set(req, verdict.player);
        return { outcome: 'ok' };
      }
      const retryAfterSec = gates.failedAuth(req.socket.remoteAddress ?? 'unknown', now());
      if (retryAfterSec !== undefined) return { outcome: 'limited', retryAfterSec };
      return { outcome: verdict.outcome };
    },
    onToolCall(playerId, body, res): Refusal | undefined {
      if (Array.isArray(body)) return { status: 400, message: 'batch_not_allowed' };
      const player = players.get(res.req);
      if (player === undefined) return { status: 401, message: 'unauthorized' };
      if (!gates.acquire(playerId)) {
        return { status: 429, message: 'too_many_open_requests', retryAfterSec: 1 };
      }
      res.once('close', () => gates.release(playerId));
      if (!isToolCall(body)) return undefined;
      const retryAfterSec = gates.call(playerId, player.ownerId, now());
      if (retryAfterSec === undefined) return undefined;
      return { status: 429, message: 'rate_limited', retryAfterSec };
    },
  });

  const unsubscribe = options.store.onRevoke(({ playerId }) => {
    mock.endPlayerSessions(playerId, 'session_revoked').catch(() => undefined);
  });

  return {
    async listen(requested = options.http.port) {
      port = await mock.listen(requested, options.http.bind);
      return port;
    },
    async close() {
      unsubscribe();
      await mock.close();
    },
  };
}
