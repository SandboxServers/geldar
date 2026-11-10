import { timingSafeEqual } from 'node:crypto';
import { Client, type ClientConfig, type Pool } from 'pg';
import type { ResolvedToken, TokenStore } from '../ports.ts';

/** How long a token that resolved stays cached (spec 5.15.3). A miss is never cached. */
export const HIT_CACHE_MS = 5_000;
/** The most often a token's `last_used_at` is written. */
export const TOUCH_EVERY_MS = 60_000;
/** The NOTIFY channel the migration's trigger sends on revocation. */
export const REVOKE_CHANNEL = 'mcp_token_revoked';
const RECONNECT_MS = 1_000;
/** Clock slack when a reconnect asks for the revocations made since the drop. */
const CATCH_UP_MARGIN_MS = 60_000;
const MAX_CACHE_ENTRIES = 4_096;

/** One `mcp_tokens` row joined to its `mcp_players` row. */
export interface TokenRow {
  token_id: string;
  token_hash: Buffer;
  player_id: string;
  life_id: string;
  owner_id: string;
  display_name: string;
  harness: string;
  status: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const RESOLVE_SQL = `SELECT t.token_id, t.token_hash, t.expires_at, t.revoked_at,
  p.player_id, p.life_id, p.owner_id, p.display_name, p.harness, p.status
FROM mcp_tokens t JOIN mcp_players p ON p.player_id = t.player_id
WHERE t.token_hash = $1`;

/**
 * The resolved token when the row is active: not revoked, not expired, the player active and
 * the harness enabled. Null for anything else, including a harness the config does not list.
 */
export function activeToken(
  row: TokenRow,
  nowMs: number,
  harnesses: Readonly<Record<string, boolean>>,
): ResolvedToken | null {
  if (row.revoked_at !== null) return null;
  if (row.expires_at.getTime() <= nowMs) return null;
  if (row.status !== 'active') return null;
  if (harnesses[row.harness] !== true) return null;
  return {
    tokenId: row.token_id,
    player: {
      playerId: row.player_id,
      lifeId: row.life_id,
      ownerId: row.owner_id,
      displayName: row.display_name,
      harness: row.harness,
      status: 'active',
    },
  };
}

interface Revocation {
  tokenId: string;
  playerId: string;
}

/**
 * Hashed Bearer tokens in Postgres. Lookup is by hash, then a constant-time comparison. A hit is
 * cached for 5 s; a revocation (LISTEN on mcp_token_revoked) drops the cache entry at once.
 */
export class PgTokenStore implements TokenStore {
  private readonly pool: Pool;
  private readonly harnesses: Readonly<Record<string, boolean>>;
  private readonly listenConfig: ClientConfig;
  private readonly openListener: (config: ClientConfig) => Client;
  private readonly hits = new Map<string, { value: ResolvedToken; untilMs: number }>();
  private readonly touched = new Map<string, number>();
  private readonly listeners = new Set<(revoked: Revocation) => void>();
  private listenClient: Client | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  /** When the LISTEN connection was last lost; null until it has been lost. */
  private lostAtMs: number | null = null;
  /** Bumped on every revocation: a row read before one may be stale, so it is not cached. */
  private revokeEpoch = 0;

  /**
   * `harnesses` is the config's `sovereign.harnesses` map. `listenConfig` opens the dedicated
   * connection that LISTENs for revocations; it cannot be a pooled connection. `openListener` is
   * the way that connection is made; tests pass a fake.
   */
  constructor(
    pool: Pool,
    harnesses: Readonly<Record<string, boolean>>,
    listenConfig: ClientConfig,
    openListener: (config: ClientConfig) => Client = (config) => new Client(config),
  ) {
    this.pool = pool;
    this.harnesses = harnesses;
    this.listenConfig = listenConfig;
    this.openListener = openListener;
  }

  async resolve(tokenHash: Uint8Array, nowMs: number): Promise<ResolvedToken | null> {
    const key = Buffer.from(tokenHash).toString('hex');
    const cached = this.hits.get(key);
    if (cached !== undefined && cached.untilMs > nowMs) return cached.value;
    this.hits.delete(key);

    const epoch = this.revokeEpoch;
    const { rows } = await this.pool.query<TokenRow>(RESOLVE_SQL, [Buffer.from(tokenHash)]);
    const row = rows[0];
    if (row === undefined || row.token_hash.length !== tokenHash.length) return null;
    if (!timingSafeEqual(row.token_hash, tokenHash)) return null;

    const resolved = activeToken(row, nowMs, this.harnesses);
    // A revocation that landed while the row was read would be cached for 5 s: skip the write.
    if (resolved !== null && epoch === this.revokeEpoch) {
      this.pruneIfFull(this.hits);
      this.hits.set(key, { value: resolved, untilMs: nowMs + HIT_CACHE_MS });
    }
    return resolved;
  }

  async touch(tokenId: string, nowMs: number): Promise<void> {
    const last = this.touched.get(tokenId);
    if (last !== undefined && nowMs - last < TOUCH_EVERY_MS) return;
    this.pruneIfFull(this.touched);
    this.touched.set(tokenId, nowMs);
    await this.pool.query('UPDATE mcp_tokens SET last_used_at = $2 WHERE token_id = $1', [
      tokenId,
      new Date(nowMs),
    ]);
  }

  onRevoke(listener: (revoked: Revocation) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Opens the LISTEN connection. A dropped connection is re-opened after one second. */
  async start(): Promise<void> {
    this.stopped = false;
    const listener = this.openListener(this.listenConfig);
    // A connection that is no longer the current one may still report its end late; it must not
    // clear the live client or schedule a second reconnect.
    const lost = (): void => {
      if (this.listenClient !== listener) return;
      this.listenClient = null;
      if (this.lostAtMs === null) this.lostAtMs = Date.now();
      this.reconnect();
    };
    listener.on('notification', (message) =>
      this.handleNotification(message.channel, message.payload),
    );
    listener.on('error', lost);
    listener.on('end', lost);
    // Assigned before the first await: a drop during connect() is then seen by lost(), and stop()
    // ends this connection instead of leaking it.
    this.listenClient = listener;
    try {
      await listener.connect();
      await listener.query(`LISTEN ${REVOKE_CHANNEL}`);
      if (this.stopped) throw new Error('the revoke listener was stopped during start');
      this.hits.clear();
      // A NOTIFY sent while the connection was down is lost: fire what that gap hid. LISTEN is
      // already in place, so nothing revoked from here on is missed.
      const since = this.lostAtMs;
      if (since !== null) await this.catchUp(since);
    } catch (error) {
      if (this.listenClient === listener) this.listenClient = null;
      await listener.end().catch(() => undefined);
      throw error;
    }
    // A drop during catch-up has already replaced this connection: the gap is not closed, so the
    // next start() catches up from the same earliest loss.
    if (this.listenClient === listener) this.lostAtMs = null;
  }

  /**
   * Fires the revocations since `sinceMs`, and every token of a player that is not active (its
   * status change sent a NOTIFY the gap may have hidden).
   */
  private async catchUp(sinceMs: number): Promise<void> {
    const { rows } = await this.pool.query<{ token_id: string; player_id: string }>(
      `SELECT t.token_id, t.player_id FROM mcp_tokens t JOIN mcp_players p
        ON p.player_id = t.player_id
       WHERE t.revoked_at >= $1 OR p.status <> 'active'`,
      [new Date(sinceMs - CATCH_UP_MARGIN_MS)],
    );
    for (const row of rows) this.fire({ tokenId: row.token_id, playerId: row.player_id });
  }

  /** Closes the LISTEN connection and stops reconnecting. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const listener = this.listenClient;
    this.listenClient = null;
    await listener?.end().catch(() => undefined);
  }

  private reconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => this.reconnect());
    }, RECONNECT_MS);
    this.reconnectTimer.unref();
  }

  private handleNotification(channel: string, payload: string | undefined): void {
    if (channel !== REVOKE_CHANNEL) return;
    const revoked = parseRevocation(payload);
    if (revoked === null) return;
    this.fire(revoked);
  }

  /** Drops the cached hit for the token, then calls each listener (one failure does not stop the rest). */
  private fire(revoked: Revocation): void {
    this.revokeEpoch += 1;
    for (const [key, entry] of this.hits) {
      if (entry.value.tokenId === revoked.tokenId) this.hits.delete(key);
    }
    for (const listener of this.listeners) {
      try {
        listener(revoked);
      } catch {
        // One listener's failure must not keep the others from ending their sessions.
      }
    }
  }

  private pruneIfFull<V>(map: Map<string, V>): void {
    if (map.size >= MAX_CACHE_ENTRIES) map.clear();
  }
}

/** The NOTIFY payload: `{"token_id": ..., "player_id": ...}`. Anything else is ignored. */
export function parseRevocation(payload: string | undefined): Revocation | null {
  if (payload === undefined) return null;
  try {
    const value = JSON.parse(payload) as Partial<Record<'token_id' | 'player_id', unknown>>;
    if (typeof value.token_id !== 'string' || typeof value.player_id !== 'string') return null;
    return { tokenId: value.token_id, playerId: value.player_id };
  } catch {
    return null;
  }
}
