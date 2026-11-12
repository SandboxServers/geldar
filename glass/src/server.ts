/** Wires the pool, the stream hub and the handler into one HTTP server. Nothing listens here. */
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { assertLoopback, type GlassConfig, HEARTBEAT_MS } from './config.ts';
import { RateLimiter } from './guard.ts';
import { createHandler } from './http.ts';
import { KinoAudit, sqlAuditStore } from './kino/audit.ts';
import { startAuditPurge } from './kino/purge.ts';
import type { FeedSource } from './kino/relay.ts';
import { buildKino, loadKinoEnv } from './kino/wiring.ts';
import { type PublicPolicy, visibilityAt } from './policy.ts';
import { type SqlClient, streamStartCursor, type ThoughtCursor, thoughtsAfter } from './query.ts';
import { SseHub } from './sse.ts';

/** Rows the stream reads per poll: a burst is spread over ticks, not held in memory. */
const STREAM_BATCH_ROWS = 100;

/** A stream is ended after this long; the page's EventSource reconnects with backoff. */
export const MAX_STREAM_AGE_MS = 10 * 60_000;

/** A connect that hangs longer than this fails, so a poll can never wait on it forever. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Time a client has to send its request headers; a slow-header (slowloris) connection is closed after it. */
export const HEADERS_TIMEOUT_MS = 10_000;

/** Time a client has to send the whole request. Glass routes take no body, so this is short. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** How long an idle keep-alive connection stays open (Caddy reuses its connection within this). */
export const KEEP_ALIVE_TIMEOUT_MS = 5_000;

/** Most open connections at once; SSE streams are capped lower, so this leaves room for the API. */
export const MAX_CONNECTIONS = 256;

export interface GlassParts {
  server: Server;
  hub: SseHub;
  pool: Pool;
  /** Stops the hub, the server and the pool. Idempotent: a second call (a second SIGTERM) does nothing. */
  close: () => void;
}

/** The stream's feed: the thoughts after a cursor that the policy lets a reader see. */
export function streamFeed(db: SqlClient, policy: PublicPolicy) {
  return (after: ThoughtCursor) =>
    thoughtsAfter(db, after, STREAM_BATCH_ROWS, visibilityAt(policy));
}

/** Builds Glass without listening. The loopback check runs here too, before any socket exists. */
export function buildGlass(
  config: GlassConfig,
  kinoFeed?: FeedSource,
  kinoOtlpEndpoint?: string,
): GlassParts {
  assertLoopback(config.host);
  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    database: config.pg.database,
    password: config.pg.password,
    max: 4,
    statement_timeout: 10_000,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    application_name: 'geldar-glass',
  });
  pool.on('error', () => {
    // An idle client failed. pg retires it; the error text can name the host, so it is not logged.
  });
  const limiter = new RateLimiter({ ...config.rateLimit, now: () => Date.now() });
  const policy: PublicPolicy = {
    trustedProxies: new Set(config.trustedProxies),
    publicHosts: new Set(config.publicHosts ?? []),
    limiter,
    kinoStaticLimiter: new RateLimiter({
      perMinute: 600,
      burst: 200,
      maxClients: config.rateLimit.maxClients,
      now: () => Date.now(),
    }),
    kinoTargetsLimiter: new RateLimiter({
      perMinute: 30,
      burst: 10,
      maxClients: config.rateLimit.maxClients,
      now: () => Date.now(),
    }),
    delaySeconds: config.delaySeconds,
    showLivingSovereign: config.showLivingSovereign,
    enabled: () => config.enabled,
    now: () => Date.now(),
  };
  const hub = new SseHub({
    maxClients: config.sseMaxClients,
    perClient: config.ssePerClient ?? 2,
    bufferFrames: config.sseBufferFrames,
    pollMs: config.ssePollMs,
    heartbeatMs: HEARTBEAT_MS,
    maxAgeMs: MAX_STREAM_AGE_MS,
    enabled: policy.enabled,
    start: () => streamStartCursor(pool, config.delaySeconds),
    fetch: streamFeed(pool, policy),
    log: (entry) => console.log(JSON.stringify(entry)),
  });
  // Kino is mounted only when a feed is given (GELDAR_KINO_ENABLED, default off). Without one there
  // is no /kino page and no upgrade handler: a WebSocket upgrade is refused by closing the socket.
  const kino =
    kinoFeed === undefined
      ? undefined
      : buildKino({
          db: pool,
          feed: kinoFeed,
          sessionKey: config.sessionKey,
          glassEnabled: policy.enabled,
          otlpEndpoint: kinoOtlpEndpoint,
          trustedProxies: policy.trustedProxies,
          allowedOrigins: loadKinoEnv().allowedOrigins,
        });
  // The retention purge belongs to Glass, not to Kino: it runs even when Kino is off.
  const purge = startAuditPurge(new KinoAudit(sqlAuditStore(pool), () => {}));
  // /kino/* goes through the same kill switch, Host check, size caps and rate limit as every route.
  const server = createServer(
    createHandler({
      db: pool,
      hub,
      policy,
      ...(config.sessionKey === undefined ? {} : { sessionKey: config.sessionKey }),
      ...(kino === undefined ? {} : { extra: (req, res) => kino.http(req, res) }),
    }),
  );
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxConnections = MAX_CONNECTIONS;
  server.on('upgrade', (req, socket) => {
    if (kino === undefined) socket.destroy();
    else kino.upgrade(req, socket);
  });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    kino?.stop();
    purge.stop();
    hub.close();
    server.close();
    void pool.end();
  };
  return { server, hub, pool, close };
}
