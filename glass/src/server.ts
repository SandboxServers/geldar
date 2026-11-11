/** Wires the pool, the stream hub and the handler into one HTTP server. Nothing listens here. */
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { assertLoopback, type GlassConfig, HEARTBEAT_MS } from './config.ts';
import { RateLimiter } from './guard.ts';
import { createHandler } from './http.ts';
import { type PublicPolicy, visibilityAt } from './policy.ts';
import { type SqlClient, streamStartCursor, type ThoughtCursor, thoughtsAfter } from './query.ts';
import { SseHub } from './sse.ts';

/** Rows the stream reads per poll: a burst is spread over ticks, not held in memory. */
const STREAM_BATCH_ROWS = 100;

/** A connect that hangs longer than this fails, so a poll can never wait on it forever. */
const CONNECT_TIMEOUT_MS = 5_000;

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
export function buildGlass(config: GlassConfig): GlassParts {
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
    delaySeconds: config.delaySeconds,
    showLivingSovereign: config.showLivingSovereign,
    enabled: () => config.enabled,
    now: () => Date.now(),
  };
  const hub = new SseHub({
    maxClients: config.sseMaxClients,
    bufferFrames: config.sseBufferFrames,
    pollMs: config.ssePollMs,
    heartbeatMs: HEARTBEAT_MS,
    enabled: policy.enabled,
    start: () => streamStartCursor(pool),
    fetch: streamFeed(pool, policy),
    log: (entry) => console.log(JSON.stringify(entry)),
  });
  const server = createServer(createHandler({ db: pool, hub, policy }));
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    hub.close();
    server.close();
    void pool.end();
  };
  return { server, hub, pool, close };
}
