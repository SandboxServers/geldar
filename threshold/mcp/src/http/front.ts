import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthDecision, MockHttp, Refusal } from '@geldar/mcp-mock';
import { createMockHttp } from '@geldar/mcp-mock';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConfig } from '../config.ts';
import type { PlayerRecord, RateLimiter, TokenStore } from '../ports.ts';
import {
  type BearerVerdict,
  clientAddress,
  MissCache,
  parseBearer,
  tokenDigest,
  trustedProxies,
  verifyBearer,
} from './auth.ts';
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
  /** Test seam: the request timeout and the per-address cap. Defaults: 30 s and the config's cap. */
  limits?: { requestTimeoutMs?: number; maxConnectionsPerAddress?: number };
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
// Receiving one whole request; a held response is not cut, the timeout ends at the request's end.
const REQUEST_TIMEOUT_MS = 30_000;
// Defaults for the config keys max_connections and max_connections_per_address (phase0.yaml). Behind
// the tunnel one address carries every player, so 32 per address fits about eight players' requests.
const MAX_CONNECTIONS = 256;
const MAX_CONNECTIONS_PER_ADDRESS = 32;

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

function tooManyOpen(): Refusal {
  return { status: 429, message: 'too_many_open_requests', retryAfterSec: 1 };
}

/** A refusal for a client that left before its request was served; nothing is sent to it anyway. */
function clientGone(): Refusal {
  return { status: 499, message: 'client_gone' };
}

/**
 * Runs `release` when the response closes. A response that has already closed will not fire
 * 'close' again, so `release` runs at once then and the result is false.
 */
function releaseOnClose(res: ServerResponse, release: () => void): boolean {
  if (res.closed || res.destroyed) {
    release();
    return false;
  }
  res.once('close', release);
  return true;
}

function refusedRateLimit(retryAfterSec: number | undefined): Refusal | undefined {
  if (retryAfterSec === undefined) return undefined;
  return { status: 429, message: 'rate_limited', retryAfterSec };
}

/**
 * The HTTP front of the real MCP server: bearer auth through the token store, Host and Origin
 * checks, body and batch limits, the call and failed-auth budgets, and revocation.
 */
export function createFrontDoor(options: FrontDoorOptions): FrontDoor {
  const now = options.now ?? Date.now;
  const gates = new FrontLimits(options.limiter);
  // Only a peer on the trusted list may name the client, in the configured header. An empty list trusts none.
  const trusted = trustedProxies(options.http.trustedProxies ?? []);
  const clientIpHeader = options.http.clientIpHeader ?? 'cf-connecting-ip';
  const addressOf = (req: IncomingMessage): string =>
    clientAddress(req, trusted, clientIpHeader).address;
  // Refused bearers, remembered for a few seconds so a repeat does not cost a store lookup.
  const misses = new MissCache();
  const maxPerAddress =
    options.limits?.maxConnectionsPerAddress ??
    options.http.maxConnectionsPerAddress ??
    MAX_CONNECTIONS_PER_ADDRESS;
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
      maxConnections: options.http.maxConnections ?? MAX_CONNECTIONS,
      maxConnectionsPerAddress: maxPerAddress,
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      requestTimeoutMs: options.limits?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    },
    closeRefused: true,
    // A trusted proxy carries every client, so its sockets skip the per-peer cap; each client's POSTs
    // and GET streams are capped per effective address instead, and the total cap still applies.
    exemptPeer: trusted,
    hostAllowed: (host) => hostAccepted(options.http.allowedHosts, port, host),
    async authenticate(playerId, header, req): Promise<AuthDecision> {
      // No client of this server sends Origin, so any Origin is refused, valid token or not.
      if (req.headers.origin !== undefined) return { outcome: 'forbidden' };
      const client = clientAddress(req, trusted, clientIpHeader);
      // A trusted proxy that sent no usable address is logged, not refused: the peer is used.
      if (client.warning !== undefined) {
        frontLog(options.log ?? stderrSink)({ event: `client_${client.warning}` });
      }
      const address = client.address;
      // A cached hit is authenticated traffic, so failed-auth state never blocks it. Any other
      // bearer is refused before the lookup while its address or the global bucket is out of tokens.
      const token = parseBearer(header);
      const cached =
        token !== null &&
        (options.store.isCachedHit?.(tokenDigest(options.pepper, token), now()) ?? false);
      const blockedSec = cached ? undefined : gates.authBlocked(address, now());
      if (blockedSec !== undefined) return { outcome: 'limited', retryAfterSec: blockedSec };
      let verdict: BearerVerdict;
      try {
        verdict = await verifyBearer(
          options.store,
          options.pepper,
          playerId,
          header,
          now(),
          misses,
        );
      } catch (error) {
        // A failing store is a 503 with no detail; the log keeps only the error's class name.
        frontLog(options.log ?? stderrSink)({
          event: 'auth_unavailable',
          error: (error as Error).constructor.name,
        });
        return { outcome: 'unavailable' };
      }
      if (verdict.outcome === 'ok') {
        // GET and DELETE never reach the POST hook, so the handshake bucket meters them here.
        if (req.method === 'GET' || req.method === 'DELETE') {
          const waitSec = gates.handshake(verdict.player.playerId, now());
          if (waitSec !== undefined) return { outcome: 'limited', retryAfterSec: waitSec };
        }
        players.set(req, verdict.player);
        return { outcome: 'ok' };
      }
      const retryAfterSec = gates.failedAuth(address, now());
      if (retryAfterSec !== undefined) return { outcome: 'limited', retryAfterSec };
      return { outcome: verdict.outcome, reason: verdict.reason };
    },
    // Takes the open slots before the body is read, so a slow body holds one like any open request.
    // The per-address slot is taken here, after the headers, because the connection cap sees only the
    // peer: behind a tunnel that is the proxy for every client.
    beforeBody(playerId, req, res): Refusal | undefined {
      const address = addressOf(req);
      if (!gates.acquireAddress(address, maxPerAddress)) return tooManyOpen();
      if (!gates.acquire(playerId)) {
        gates.releaseAddress(address);
        return tooManyOpen();
      }
      const held = releaseOnClose(res, () => {
        gates.release(playerId);
        gates.releaseAddress(address);
      });
      return held ? undefined : clientGone();
    },
    // A GET stream takes the per-address slot only: a player's streams are not counted as its POSTs.
    beforeStream(_playerId, req, res): Refusal | undefined {
      const address = addressOf(req);
      if (!gates.acquireAddress(address, maxPerAddress)) return tooManyOpen();
      const held = releaseOnClose(res, () => gates.releaseAddress(address));
      return held ? undefined : clientGone();
    },
    onToolCall(playerId, body, res): Refusal | undefined {
      if (Array.isArray(body)) return { status: 400, message: 'batch_not_allowed' };
      const player = players.get(res.req);
      if (player === undefined) return { status: 401, message: 'unauthorized' };
      // Every other method (initialize, resources/read, ...) takes from the cheaper handshake bucket
      // and from its owner's bucket, so a player's non-call traffic cannot outrun the owner's budget.
      if (!isToolCall(body)) {
        const waitSec = gates.handshake(playerId, now());
        if (waitSec !== undefined) return refusedRateLimit(waitSec);
        return refusedRateLimit(gates.owner(player.ownerId, now()));
      }
      return refusedRateLimit(gates.call(playerId, player.ownerId, now()));
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
