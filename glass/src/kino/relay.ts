/**
 * The Kino relay: one pane per connection. It reads the feed from an injected source and forwards it;
 * it sends nothing into the world and publishes nothing to NATS. Browser messages are subscribe and
 * unsubscribe only (kino-client.schema.json); anything else closes the socket.
 */
import { type AuditEntry, loginHash, newPaneId, type PaneAudit } from './audit.ts';
import { validFeedText } from './feed-check.ts';
import { TokenBuckets } from './limits.ts';
import { type Access, ANONYMOUS, permitted, type ScopeStore } from './scope.ts';

export const DEFAULT_PANE_CAP = 4;
/** Owner ruling: anonymous panes are bounded in total; signed-in viewers are not. */
export const DEFAULT_ANON_CEILING = 40;
/** Owner ruling: one subscribe per 2 s per client; the burst of 8 lets a four-pane page open its panes at once. */
export const SUBSCRIBE_BURST = 8;
export const SUBSCRIBE_REFILL_MS = 2000;

export type ByeReason =
  | 'unsubscribed'
  | 'target_not_permitted'
  | 'pane_cap_reached'
  | 'feed_unavailable'
  | 'feed_overloaded'
  | 'kill_switch'
  | 'session_ended';

/** What the metrics count: a bye reason, or a feed message Glass dropped as malformed, oversized or for another agent. */
export type RefusalReason = ByeReason | 'bad_feed';

/** Where feed messages come from (NATS in production). Returns the unsubscribe function. */
export interface FeedSource {
  subscribe(agentId: string, onMessage: (json: string) => void): () => void;
}

/** One browser connection, whatever the transport. */
export interface KinoConn {
  send(text: string): void;
  close(): void;
}

export interface KinoRelayOptions {
  store: ScopeStore;
  feed: FeedSource;
  paneCap?: number;
  enabled?: () => boolean;
  /** The pane audit. A rejected `record` before a subscribe closes the pane (fail closed). */
  audit?: PaneAudit;
  /** Clock for audit times. */
  now?: () => Date;
  /** Gauge hook for the open pane count. */
  onPanes?: (open: number) => void;
  /** Metric hooks (K07): a refused or ended subscribe by reason, and feed bytes forwarded. */
  onRefusal?: (reason: RefusalReason) => void;
  onBytes?: (bytes: number) => void;
  /** Total anonymous panes allowed (default 40). */
  anonCeiling?: number;
  /** Subscribe rate per client key (default burst 8, one per 2 s). */
  subscribeLimit?: { burst: number; refillMs: number };
}

/** Per-connection facts the transport knows. */
export interface AcceptOptions {
  /** Session expiry in ms since the epoch; the pane ends with session_ended at that time. */
  expiresAt?: number;
}

export interface Pane {
  message(text: string): Promise<void>;
  /** The socket closed, aborted or errored. Idempotent. */
  closed(): void;
  /** The transport cannot keep up (a slow reader): bye feed_overloaded, then close. */
  overloaded(): void;
}

interface LivePane {
  end(reason: ByeReason): void;
  recheck(): Promise<void>;
}

const TARGET = /^[a-z][a-z0-9_]{0,63}$/;
const MODES = new Set(['follow', 'orbit', 'free']);

type Parsed = { type: 'subscribe'; agent: string; mode: string } | { type: 'unsubscribe' } | null;

/** Exactly the two client messages, with no extra keys. Anything else is null. */
export function parseClientMessage(text: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (o.type === 'unsubscribe' && keys.length === 1) return { type: 'unsubscribe' };
  if (
    o.type === 'subscribe' &&
    keys.length === 3 &&
    typeof o.target_agent_id === 'string' &&
    TARGET.test(o.target_agent_id) &&
    typeof o.mode === 'string' &&
    MODES.has(o.mode)
  ) {
    return { type: 'subscribe', agent: o.target_agent_id, mode: o.mode };
  }
  return null;
}

export class KinoRelay {
  private readonly panes = new Map<string, number>();
  private readonly cap: number;
  private readonly live = new Set<LivePane>();
  private readonly limiter: TokenBuckets;
  private anonOpen = 0;

  private readonly o: KinoRelayOptions;

  constructor(o: KinoRelayOptions) {
    this.o = o;
    this.cap = o.paneCap ?? DEFAULT_PANE_CAP;
    const lim = o.subscribeLimit ?? { burst: SUBSCRIBE_BURST, refillMs: SUBSCRIBE_REFILL_MS };
    this.limiter = new TokenBuckets({ ...lim, now: () => this.nowMs() });
  }

  /** Open panes across all sessions. */
  get openPanes(): number {
    let n = 0;
    for (const c of this.panes.values()) n += c;
    return n;
  }

  /**
   * Takes a pane slot for a session. `sessionKey` is the identity hash, or a per-client key for an
   * anonymous viewer. Returns null (after a bye and a close) when the cap or the kill switch refuses.
   */
  accept(
    conn: KinoConn,
    sessionKey: string,
    identityHash: string | null,
    opts: AcceptOptions = {},
  ): Pane | null {
    if (this.o.enabled?.() === false) return this.refuse(conn, 'kill_switch');
    const anon = identityHash === null;
    if (anon && this.anonOpen >= (this.o.anonCeiling ?? DEFAULT_ANON_CEILING))
      return this.refuse(conn, 'pane_cap_reached');
    if ((this.panes.get(sessionKey) ?? 0) >= this.cap) return this.refuse(conn, 'pane_cap_reached');
    this.panes.set(sessionKey, (this.panes.get(sessionKey) ?? 0) + 1);
    if (anon) this.anonOpen += 1;
    this.o.onPanes?.(this.openPanes);
    let done = false;
    let stop: (() => void) | null = null;
    const paneId = newPaneId();
    const login = loginHash(identityHash, sessionKey);
    let live: { agent: string; mode: AuditEntry['mode'] } | null = null;
    const entry = (event: AuditEntry['event'], agent: string, mode: AuditEntry['mode']) => {
      const at = (this.o.now?.() ?? new Date()).toISOString();
      const e: AuditEntry = {
        event,
        login_hash: login,
        agent_id: agent,
        pane_id: paneId,
        mode,
        at,
      };
      if (event === 'pane_closed') e.stopped_at = at;
      return e;
    };
    /** The pane stopped watching: write pane_closed. The write is reported by the audit; it cannot reopen. */
    const auditClose = (): void => {
      if (live === null || !this.o.audit) return;
      const e = entry('pane_closed', live.agent, live.mode);
      live = null;
      this.o.audit.record(e).catch(() => {});
    };
    const release = (): void => {
      if (done) return;
      done = true;
      stop?.();
      stop = null;
      this.live.delete(handle);
      auditClose();
      if (anon) this.anonOpen -= 1;
      const left = (this.panes.get(sessionKey) ?? 1) - 1;
      if (left <= 0) this.panes.delete(sessionKey);
      else this.panes.set(sessionKey, left);
      this.o.onPanes?.(this.openPanes);
    };
    const end = (reason: ByeReason): void => {
      if (!done) {
        this.o.onRefusal?.(reason);
        conn.send(JSON.stringify({ type: 'bye', reason }));
      }
      release();
      conn.close();
    };
    /** Permission is checked at subscribe and again here, so a ban, a switched-off camera or an expired cookie ends the pane. */
    const recheck = async (): Promise<void> => {
      if (done) return;
      if (opts.expiresAt !== undefined && this.nowMs() >= opts.expiresAt)
        return end('session_ended');
      if (this.o.enabled?.() === false) return end('kill_switch');
      if (live === null) return;
      const agent = live.agent;
      let ok = false;
      try {
        const access: Access =
          identityHash === null ? ANONYMOUS : await this.o.store.access(identityHash);
        ok = permitted(access, await this.o.store.agent(agent));
      } catch {
        return; // a database blip does not end a pane; the next round asks again
      }
      if (!done && !ok) end('target_not_permitted');
    };
    const handle: LivePane = { end, recheck };
    this.live.add(handle);
    return {
      closed: release,
      overloaded: () => end('feed_overloaded'),
      message: async (text) => {
        if (done) return;
        const msg = parseClientMessage(text);
        if (msg === null) {
          release();
          conn.close();
          return;
        }
        if (msg.type === 'unsubscribe') {
          stop?.();
          stop = null;
          auditClose();
          conn.send(JSON.stringify({ type: 'bye', reason: 'unsubscribed' }));
          return;
        }
        if (this.o.enabled?.() === false) return end('kill_switch');
        if (!this.limiter.take(sessionKey)) return end('feed_overloaded');
        let ok = false;
        try {
          const access: Access =
            identityHash === null ? ANONYMOUS : await this.o.store.access(identityHash);
          ok = permitted(access, await this.o.store.agent(msg.agent));
        } catch {
          if (!done) end('feed_unavailable');
          return;
        }
        if (done) return;
        if (!ok) return end('target_not_permitted');
        const mode = msg.mode as AuditEntry['mode'];
        const event =
          live === null
            ? 'pane_opened'
            : live.agent !== msg.agent
              ? 'pane_targeted'
              : 'pane_mode_changed';
        if (live !== null && live.agent === msg.agent && stop !== null) {
          // Same target, new mode: one audit row, and the feed is left alone (no stop, no resync).
          if (this.o.audit) {
            try {
              await this.o.audit.record(entry(event, msg.agent, mode));
            } catch {
              if (!done) end('feed_unavailable');
              return;
            }
          }
          if (!done) live = { agent: msg.agent, mode };
          return;
        }
        if (this.o.audit) {
          try {
            await this.o.audit.record(entry(event, msg.agent, mode));
          } catch {
            // Fail closed: the write failed, so the pane does not run unaudited.
            if (!done) end('feed_unavailable');
            return;
          }
          if (done) {
            // The socket closed while the write was in flight: record the stop, open nothing.
            live = { agent: msg.agent, mode };
            auditClose();
            return;
          }
        }
        stop?.();
        live = { agent: msg.agent, mode };
        const target = msg.agent;
        stop = this.o.feed.subscribe(target, (json) => {
          if (done || live?.agent !== target) return;
          if (!validFeedText(json) || !this.forMe(json, target)) {
            this.o.onRefusal?.('bad_feed'); // dropped and counted, never forwarded
            return;
          }
          this.o.onBytes?.(Buffer.byteLength(json));
          conn.send(json);
        });
      },
    };
  }

  /** Sends `bye` with the reason to every live pane and closes it (the kill switch going off). */
  endAll(reason: ByeReason): void {
    for (const p of [...this.live]) p.end(reason);
  }

  /** Re-asks the store for every live pane (ban, public_camera off, expiry). Run it on a timer. */
  async revalidateAll(): Promise<void> {
    for (const p of [...this.live]) await p.recheck();
  }

  /** A message that names its target (hello, target_moved) must name this pane's agent. */
  private forMe(json: string, agent: string): boolean {
    const m = JSON.parse(json) as { type: string; target_agent_id?: string };
    return m.target_agent_id === undefined || m.target_agent_id === agent;
  }

  private nowMs(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }

  private refuse(conn: KinoConn, reason: ByeReason): null {
    this.o.onRefusal?.(reason);
    conn.send(JSON.stringify({ type: 'bye', reason }));
    conn.close();
    return null;
  }
}
