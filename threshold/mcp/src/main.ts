import { readFile } from 'node:fs/promises';
import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import type { RequestTransport } from '@geldar/animus/src/link/nats-body-link.ts';
import { createOutputValidator } from '@geldar/animus/src/validate/index.ts';
import type { Clock, WakeConfig } from '@geldar/mcp-mock';
import { checkSovereignIdentity } from '@geldar/repo-checks/src/identity-mode.ts';
import type { Client, ClientConfig, Pool } from 'pg';
import { parse } from 'yaml';
import { NatsBodyGateway } from './body-gateway.ts';
import { type McpConfig, parseMcpConfig } from './config.ts';
import type { RunState } from './events/mapper.ts';
import { RingEventLog } from './events/player-log.ts';
import {
  handleStreamMessage,
  replayStartIso,
  type StreamCounters,
  streamSubjects,
} from './events/stream.ts';
import { createFrontDoor, type FrontDoor, type FrontDoorOptions } from './http/front.ts';
import { safeLogLine } from './http/log.ts';
import type { KeepAlive, RateDecision, RateLimiter } from './ports.ts';
import { type BucketManager, KvPresenceStore, openPresenceBucket } from './presence.ts';
import { SovereignCallRecorder } from './record/sovereign-call.ts';
import { PgAgentStore } from './store/pg-agents.ts';
import { PgBudgetLedger } from './store/pg-budget.ts';
import { PgJournalStore } from './store/pg-journal.ts';
import { PgPlayerDirectory } from './store/pg-players.ts';
import { listenerConfig, PgTokenStore } from './store/pg-tokens.ts';
import { createWorld } from './world.ts';
import { createWorldSession, type WorldSessionDeps } from './world-session.ts';

/** A shard file the identity-mode rule (spec 5.15.8) refuses. The message names the file and the rule only. */
export class ConfigRejected extends Error {
  override name = 'ConfigRejected';
}

/** The connection options the Postgres pool and the revoke listener share; the password is read from its file. */
export interface PgOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** The NATS side the server uses: request/reply for the Body, the call sink, the buckets and the replay. */
export interface NatsLink {
  request: RequestTransport;
  buckets: BucketManager;
  /** Publishes one `sovereign_call` with its `Nats-Msg-Id`. */
  publishCall(msgId: string, payload: unknown): Promise<void>;
  /** Replays the stream from `fromIso` and calls `onMessage` in order; resolves once the consumer is live. */
  replay(
    subjects: string[],
    fromIso: string,
    onMessage: (seq: number, raw: unknown) => Promise<void>,
  ): Promise<{ stop(): Promise<void> }>;
  /** Closes the connection after in-flight messages finish. */
  drain(): Promise<void>;
}

/** Everything `startMcp` reaches outside the process. Tests pass fakes; the container passes the real ones (cli.ts). */
export interface McpPorts {
  readSecret(path: string): Promise<string>;
  openPool(options: PgOptions): Pool;
  connectNats(url: string): Promise<NatsLink>;
  /** The LISTEN connection for token revocations; a pg Client in production, a fake in tests. */
  openRevokeListener(config: ClientConfig): Client;
  keepAlive: KeepAlive;
  clock: Clock;
  /** Receives one log line, always cut by `safeLogLine` first. */
  log(line: Record<string, string | number>): void;
  /** The front door; `createFrontDoor` in production. Tests return a fake that never listens. */
  frontDoor?: (options: FrontDoorOptions) => FrontDoor;
}

/** A started server: its bound port, and a stop that follows the graceful order. */
export interface RunningMcp {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * Reads the shard file, applies the identity-mode rule (spec 5.15.8, the same check the YAML
 * tool runs on `shards/*.yaml`), then the WM-01 loader. A rejected file never reaches the loader.
 */
export async function loadStartConfig(file: string, env: Record<string, string | undefined>) {
  const text = await readFile(file, 'utf8');
  const issues = checkSovereignIdentity(file, text);
  if (issues.length > 0) throw new ConfigRejected(issues.join('; '));
  return parseMcpConfig(parse(text), { env });
}

/** A bucket's size: `capacity` tokens, and `perMinute` of them added back over each minute. */
export interface BucketRule {
  capacity: number;
  perMinute: number;
}

/** The failed-auth budget for all addresses together (the approved 300 a minute; not configurable). */
export const GLOBAL_FAILED_AUTH_PER_MINUTE = 300;

/**
 * The rule for each bucket, by name: the front door's `player:`, `owner:`, `auth-failed:` buckets
 * and the tools' `act:` and `say:` buckets, whose minimum spacing is one token per N seconds.
 */
export function bucketRules(
  limits: Pick<
    McpConfig['sovereign']['rateLimits'],
    | 'callsPerMinute'
    | 'ownerCallsPerMinute'
    | 'failedAuthPerMinute'
    | 'handshakePerMinute'
    | 'actMinSeconds'
    | 'sayMinSeconds'
  >,
): (bucket: string) => BucketRule {
  const perMinute = (n: number): BucketRule => ({ capacity: n, perMinute: n });
  const spaced = (seconds: number): BucketRule =>
    seconds > 0 ? { capacity: 1, perMinute: 60 / seconds } : perMinute(limits.callsPerMinute);
  return (bucket) => {
    if (bucket.startsWith('owner:')) return perMinute(limits.ownerCallsPerMinute);
    if (bucket.startsWith('auth-failed:address:')) return perMinute(limits.failedAuthPerMinute);
    if (bucket === 'auth-failed:global') return perMinute(GLOBAL_FAILED_AUTH_PER_MINUTE);
    if (bucket.startsWith('handshake:')) return perMinute(limits.handshakePerMinute);
    if (bucket.startsWith('act:')) return spaced(limits.actMinSeconds);
    if (bucket.startsWith('say:')) return spaced(limits.sayMinSeconds);
    return perMinute(limits.callsPerMinute);
  };
}

/** Above this many buckets the limiter drops the full ones: a full bucket is the same as a new one. */
const SWEEP_AT = 1_000;

/**
 * A token bucket per key, sized by `ruleOf`. A bucket that has refilled to full is dropped when the
 * table grows, so an address that rotates through IPv6 cannot grow the table without bound.
 */
export function tokenBucketLimiter(ruleOf: (bucket: string) => BucketRule): RateLimiter {
  const buckets = new Map<string, { tokens: number; atMs: number }>();
  let sweepAt = SWEEP_AT;
  // The bucket refilled to `nowMs`, and the decision for one token from it. Writes nothing.
  const read = (bucket: string, nowMs: number) => {
    const rule = ruleOf(bucket);
    const state = buckets.get(bucket) ?? { tokens: rule.capacity, atMs: nowMs };
    const tokens = Math.min(
      rule.capacity,
      state.tokens + ((nowMs - state.atMs) * rule.perMinute) / 60_000,
    );
    const decision: RateDecision =
      tokens >= 1
        ? { allowed: true, retryAfterMs: 0 }
        : { allowed: false, retryAfterMs: Math.ceil(((1 - tokens) * 60_000) / rule.perMinute) };
    return { rule, tokens, decision };
  };
  const sweep = (nowMs: number) => {
    for (const key of [...buckets.keys()]) {
      const { rule, tokens } = read(key, nowMs);
      if (tokens >= rule.capacity) buckets.delete(key);
    }
    sweepAt = Math.max(SWEEP_AT, buckets.size * 2);
  };
  return {
    take(bucket: string, nowMs: number): RateDecision {
      if (buckets.size >= sweepAt) sweep(nowMs);
      const { tokens, decision } = read(bucket, nowMs);
      buckets.set(bucket, { tokens: decision.allowed ? tokens - 1 : tokens, atMs: nowMs });
      return decision;
    },
    peek(bucket: string, nowMs: number): RateDecision {
      return read(bucket, nowMs).decision;
    },
  };
}

/** The shortest HMAC pepper the server accepts; a shorter one is refused at startup. */
export const PEPPER_MIN_BYTES = 32;

/**
 * The pepper bytes from its file's text, read as `tools/mcp-tokens` reads it: one trailing LF or
 * CRLF is removed and nothing else, so a minted token verifies here. The message names the rule,
 * never the pepper.
 */
export function pepperBytes(text: string): Buffer {
  const bytes = Buffer.from(text.replace(/\r?\n$/, ''), 'utf8');
  if (bytes.length < PEPPER_MIN_BYTES) {
    throw new ConfigRejected(`pepper is shorter than ${PEPPER_MIN_BYTES} bytes`);
  }
  return bytes;
}

/**
 * The Postgres password from its file's text, read as `tools/migrate` reads it: a leading byte-order
 * mark and one trailing LF or CRLF are removed. Edge whitespace is refused, not trimmed, so the
 * password the runner set is the one this server sends. The message never names the password.
 */
export function postgresPassword(text: string): string {
  const password = text.replace(/^﻿/, '').replace(/\r?\n$/, '');
  if (/^\s|\s$/.test(password)) {
    throw new ConfigRejected(
      'the Postgres password must not start or end with whitespace: remove the extra spaces or tabs from its file',
    );
  }
  return password;
}

/** How long a read of the living lives or of one life's identity is reused. */
export const LIFE_CACHE_MS = 5_000;

/**
 * The living lives and each life's speech identity, read from `agents` on first use and reused for
 * `LIFE_CACHE_MS`, so a life added while the server runs is picked up without a restart. A life whose
 * identity cannot be read gets an empty identity: its speech is classified without a name, never dropped.
 */
export function lazyLifeRegistry(agents: PgAgentStore, clock: Clock) {
  let lives: { atMs: number; ids: string[] } | null = null;
  const identities = new Map<string, { atMs: number; identity: SpeechIdentity }>();
  return {
    async lives(): Promise<string[]> {
      const now = clock.nowMs();
      if (lives === null || now - lives.atMs >= LIFE_CACHE_MS) {
        lives = { atMs: now, ids: await agents.liveLifeIds() };
      }
      return lives.ids;
    },
    async identity(lifeId: string): Promise<SpeechIdentity> {
      const now = clock.nowMs();
      const cached = identities.get(lifeId);
      if (cached !== undefined && now - cached.atMs < LIFE_CACHE_MS) return cached.identity;
      const identity = await agents.identity(lifeId).catch(() => ({ name: '', username: '' }));
      identities.set(lifeId, { atMs: now, identity });
      return identity;
    },
  };
}

/**
 * Starts the server in the order the packet fixes: config (already loaded), the Postgres pool,
 * the stores, NATS, the presence bucket, the body gateway, the world, the stream replay, then the
 * front door's listen. A failure closes what was opened, in reverse, and rethrows.
 */
export async function startMcp(config: McpConfig, ports: McpPorts): Promise<RunningMcp> {
  const log = (line: Record<string, unknown>) => ports.log(safeLogLine(line));
  const now = () => ports.clock.nowMs();
  const closers: Array<() => Promise<void>> = [];
  try {
    log({ event: 'mcp_start', shard: config.shard });
    const password = postgresPassword(await ports.readSecret(config.postgres.passwordFile));
    const pepper = pepperBytes(await ports.readSecret(config.pepperFile));
    const { host, port, database, user } = config.postgres;
    const pgOptions: PgOptions = { host, port, database, user, password };
    const pool = ports.openPool(pgOptions);
    closers.push(() => pool.end());
    // The pool emits 'error' when an idle client is dropped (a Postgres restart, a statement_timeout
    // kill). With no listener that is an uncaught exception; the pool replaces the client itself.
    pool.on('error', (error: Error) => {
      const code = (error as { code?: unknown }).code;
      log({
        event: 'postgres_pool_error',
        error: error.name,
        ...(typeof code === 'string' ? { cause: code } : {}),
      });
    });
    log({ event: 'postgres_open' });

    const harnesses = config.sovereign.harnesses;
    const tokens = new PgTokenStore(pool, harnesses, listenerConfig(pgOptions), (cfg) =>
      ports.openRevokeListener(cfg),
    );
    const agents = new PgAgentStore(pool);
    const registry = lazyLifeRegistry(agents, ports.clock);

    const nats = await ports.connectNats(config.nats.url);
    closers.push(() => nats.drain());
    log({ event: 'nats_connected' });
    // The LISTEN connection starts before anything serves a request, so a revoke ends sessions at once.
    await tokens.start();
    closers.push(() => tokens.stop());
    log({ event: 'revoke_listening' });

    const presence = new KvPresenceStore(await openPresenceBucket(nats.buckets), now);
    const body = new NatsBodyGateway({ transport: nats.request, shard: config.shard });
    const events = new RingEventLog();
    const runs = new Map<string, RunState>();
    const wake: WakeConfig = {
      minSpacingMs: config.sovereign.wake.minSpacingSeconds * 1000,
      intentRunTooLongMs: config.sovereign.wake.intentRunTooLongSeconds * 1000,
    };
    const recorder = new SovereignCallRecorder({ publish: (id, p) => nats.publishCall(id, p) });
    const limiter = tokenBucketLimiter(bucketRules(config.sovereign.rateLimits));
    const world = createWorld({
      players: new PgPlayerDirectory(pool),
      body,
      budget: new PgBudgetLedger(pool, config.sovereign.budget),
      sleeps: agents,
      profiles: agents,
      journal: new PgJournalStore(pool),
      recorder,
      events,
      presence,
      limiter,
      validator: createOutputValidator(),
      clock: ports.clock,
      runs,
      wake,
      expiresAfterTicks: config.plan.expiresAfterTicks,
      laws: [],
      log,
    });
    closers.push(async () => world.close());

    const counters: StreamCounters = { invalid: 0 };
    const streamCtx = {
      map: { identity: { name: '', username: '' }, runs },
      identityOf: (lifeId: string) => registry.identity(lifeId),
      log: events,
      lives: () => registry.lives(),
    };
    const replay = await nats.replay(
      streamSubjects(config.shard),
      replayStartIso(now(), config.sovereign.replayMinutes),
      (seq, raw) => handleStreamMessage(seq, raw, streamCtx, counters),
    );
    closers.push(() => replay.stop());
    log({ event: 'replay_started' });

    const sessionDeps: WorldSessionDeps = {
      tools: world.tools,
      players: new PgPlayerDirectory(pool),
      resources: { profiles: agents, journal: new PgJournalStore(pool), shard: shardRules(config) },
      keepAlive: ports.keepAlive,
      keepaliveMs: config.sovereign.keepaliveSeconds * 1000,
      log,
    };
    const front = (ports.frontDoor ?? createFrontDoor)({
      http: config.http,
      pepper,
      store: tokens,
      limiter,
      createSession: (playerId, signal) => createWorldSession(sessionDeps, playerId, signal),
      log: (line) => ports.log(line),
      now,
    });
    closers.push(() => front.close());
    const bound = await front.listen();
    log({ event: 'listening', port: bound });
    return { port: bound, stop: () => stopInOrder(closers.slice().reverse(), log) };
  } catch (error) {
    await stopInOrder(closers.slice().reverse(), log);
    throw error;
  }
}

/**
 * Runs each closer in turn: a failing closer is logged by class and the rest still run. Called with
 * the closers in the graceful order: front door (stop accepting), world (timers), replay (consumer),
 * NATS drain, then the pool.
 */
async function stopInOrder(
  closers: Array<() => Promise<void>>,
  log: (line: Record<string, unknown>) => void,
): Promise<void> {
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      log({ event: 'close_failed', error: (error as Error).name });
    }
  }
  log({ event: 'mcp_stopped' });
}

/** The shard rules the `shard/rules` resource shows, from the loaded config. */
function shardRules(config: McpConfig) {
  return {
    chatRadius: config.chat.radius,
    waitCapSeconds: config.sovereign.waitCapSeconds,
    tickRate: config.tickRate,
  };
}
