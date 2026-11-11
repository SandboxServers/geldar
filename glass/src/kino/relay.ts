/**
 * The Kino relay: one pane per connection. It reads the feed from an injected source and forwards it;
 * it sends nothing into the world and publishes nothing to NATS. Browser messages are subscribe and
 * unsubscribe only (kino-client.schema.json); anything else closes the socket.
 */
import { type Access, ANONYMOUS, permitted, type ScopeStore } from './scope.ts';

export const DEFAULT_PANE_CAP = 4;

export type ByeReason =
  | 'unsubscribed'
  | 'target_not_permitted'
  | 'pane_cap_reached'
  | 'feed_unavailable'
  | 'feed_overloaded'
  | 'kill_switch'
  | 'session_ended';

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
  /** Narrow audit hook (K06 fills it): called once per allowed subscribe. */
  audit?: (entry: { identityHash: string | null; agentId: string; mode: string }) => void;
  /** Gauge hook for the open pane count. */
  onPanes?: (open: number) => void;
}

export interface Pane {
  message(text: string): Promise<void>;
  /** The socket closed, aborted or errored. Idempotent. */
  closed(): void;
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

  private readonly o: KinoRelayOptions;

  constructor(o: KinoRelayOptions) {
    this.o = o;
    this.cap = o.paneCap ?? DEFAULT_PANE_CAP;
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
  accept(conn: KinoConn, sessionKey: string, identityHash: string | null): Pane | null {
    if (this.o.enabled?.() === false) return this.refuse(conn, 'kill_switch');
    if ((this.panes.get(sessionKey) ?? 0) >= this.cap) return this.refuse(conn, 'pane_cap_reached');
    this.panes.set(sessionKey, (this.panes.get(sessionKey) ?? 0) + 1);
    this.o.onPanes?.(this.openPanes);
    let done = false;
    let stop: (() => void) | null = null;
    const release = (): void => {
      if (done) return;
      done = true;
      stop?.();
      stop = null;
      const left = (this.panes.get(sessionKey) ?? 1) - 1;
      if (left <= 0) this.panes.delete(sessionKey);
      else this.panes.set(sessionKey, left);
      this.o.onPanes?.(this.openPanes);
    };
    const end = (reason: ByeReason): void => {
      if (!done) conn.send(JSON.stringify({ type: 'bye', reason }));
      release();
      conn.close();
    };
    return {
      closed: release,
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
          conn.send(JSON.stringify({ type: 'bye', reason: 'unsubscribed' }));
          return;
        }
        if (this.o.enabled?.() === false) return end('kill_switch');
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
        stop?.();
        this.o.audit?.({ identityHash, agentId: msg.agent, mode: msg.mode });
        stop = this.o.feed.subscribe(msg.agent, (json) => {
          if (!done) conn.send(json);
        });
      },
    };
  }

  private refuse(conn: KinoConn, reason: ByeReason): null {
    conn.send(JSON.stringify({ type: 'bye', reason }));
    conn.close();
    return null;
  }
}
