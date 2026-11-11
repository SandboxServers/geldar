import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthDecision, MockHttp, Refusal } from '@geldar/mcp-mock';
import { createMockHttp } from '@geldar/mcp-mock';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConfig } from '../config.ts';
import { PUBLIC_DEFAULTS, type PublicConfig } from '../config-public.ts';
import type { PlayerRecord, RateLimiter, TokenStore } from '../ports.ts';
import {
  type BearerVerdict,
  clientAddress,
  clientKey,
  MissCache,
  parseBearer,
  tokenDigest,
  trustedProxies,
  verifyBearer,
} from './auth.ts';
import { FrontLimits } from './limits.ts';
import { frontLog } from './log.ts';
import { PublicRateLimit } from './public-limit.ts';
import { KILL_SWITCH_BODY, rateLimitedBody } from './public-refusals.ts';

export interface FrontDoorOptions {
  http: McpConfig['http'];
  /** The `public` block: the kill switch and the per-client rate limit. Default: no kill switch, the default limit. */
  public?: PublicConfig;
  /** The HMAC pepper, read from its file by the caller. Never logged. */
  pepper: Uint8Array;
  store: TokenStore;
  limiter: RateLimiter;
  /** One agent's fair share of the owner's calls a minute (`ownerShare`). Default 0: no sibling reserve. */
  agentShare?: number;
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
// Fallbacks for a caller that passes no cap: the config derives the real ones from owner_cap_owner (20):
// 4 open requests per agent times the owner cap per address, and that times 4 owners for the listener.
const MAX_CONNECTIONS = 320;
const MAX_CONNECTIONS_PER_ADDRESS = 80;

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
  const pub = options.public ?? PUBLIC_DEFAULTS;
  // One bucket per client address for every public request, authenticated or not.
  // Only when a public block is passed (the CLI always passes one), so a bare door in a test is not limited.
  const publicLimit =
    options.public === undefined
      ? undefined
      : new PublicRateLimit(options.public.rateLimit.perMinute, options.public.rateLimit.burst);
  const gates = new FrontLimits(options.limiter, options.agentShare ?? 0);
  // Only a peer on the trusted list may name the client, in the configured header. An empty list trusts none.
  const trusted = trustedProxies(options.http.trustedProxies ?? []);
  const clientIpHeader = options.http.clientIpHeader ?? 'x-geldar-client-ip';
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
    maxBodyBytes: options.http.maxBodyBytes ?? BODY_LIMIT_BYTES,
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
      // The kill switch answers every public request before anything else is read or counted.
      if (pub.killSwitch) return { outcome: 'answered', status: 503, body: KILL_SWITCH_BODY };
      // No client of this server sends Origin, so any Origin is refused, valid token or not.
      if (req.headers.origin !== undefined) return { outcome: 'forbidden' };
      const client = clientAddress(req, trusted, clientIpHeader);
      // A trusted proxy that sent no usable address is logged, not refused: the peer is used.
      if (client.warning !== undefined) {
        frontLog(options.log ?? stderrSink)({ event: `client_${client.warning}` });
      }
      const address = client.address;
      const waitSec = publicLimit?.take(clientKey(address), now());
      if (waitSec !== undefined) {
        return {
          outcome: 'answered',
          status: 429,
          headers: { 'Retry-After': String(waitSec) },
          body: rateLimitedBody(waitSec),
        };
      }
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
      const ownerId = players.get(req)?.ownerId ?? playerId;
      if (!gates.acquireAddress(address, maxPerAddress)) return tooManyOpen();
      if (!gates.acquireOwner(ownerId, maxPerAddress)) {
        gates.releaseAddress(address);
        return tooManyOpen();
      }
      if (!gates.acquire(playerId)) {
        gates.releaseOwner(ownerId);
        gates.releaseAddress(address);
        return tooManyOpen();
      }
      const held = releaseOnClose(res, () => {
        gates.release(playerId);
        gates.releaseOwner(ownerId);
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
      // Every other method (initialize, resources/read, ...) takes only from the handshake bucket:
      // handshake traffic draws no call token, so it cannot use up an agent's or an owner's calls.
      if (!isToolCall(body)) return refusedRateLimit(gates.handshake(playerId, now()));
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
