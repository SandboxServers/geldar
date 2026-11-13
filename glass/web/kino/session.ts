// The browser side of one Kino pane connection: the two client messages out (kino-client.schema.json),
// the feed in (kino-feed.schema.json). It sends nothing else, ever. Pure apart from the injected socket.

import type { KinoFeed } from '../../../contract/src/generated/types.ts';
import type { CameraMode } from './camera/modes.ts';
import { type FeedChange, FeedState } from './feed.ts';

/** The part of a WebSocket the session uses, so tests can fake it. */
export interface SocketLike {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export interface SessionHooks {
  /** A fresh world for a new target: the view drops the old scene. */
  onReset(state: FeedState): void;
  onChange(change: FeedChange, state: FeedState): void;
  /** The server refused a retune (rate_limited): the old target keeps playing (decision 0161). */
  onRetuneRefused?(kept: string, refused: string): void;
  /** The server ended the feed (`bye` reason), or the socket dropped (`disconnected`). */
  onEnd(reason: string): void;
}

/** What the page says for a bye reason. kill_switch is the owner turning Kino off. */
export function byeText(reason: string): string {
  switch (reason) {
    case 'kill_switch':
      return 'Kino has been switched off by the owner.';
    case 'target_not_permitted':
      return 'You may not watch this agent.';
    case 'pane_cap_reached':
      return 'Too many panes are open.';
    case 'session_ended':
      return 'The agent is no longer online.';
    case 'unsubscribed':
      return 'Stopped watching.';
    case 'disconnected':
      return 'Connection lost.';
    default:
      return 'The feed is unavailable.';
  }
}

export class KinoSession {
  private sock: SocketLike | null = null;
  private opened = false;
  private ended = false;
  private pending: string[] = [];
  private state = new FeedState();
  private readonly connect: () => SocketLike;
  private readonly hooks: SessionHooks;
  private target: string | null = null;
  /** A retune the server has not confirmed yet: the old world stays until a hello names this agent. */
  private retune: string | null = null;

  constructor(connect: () => SocketLike, hooks: SessionHooks) {
    this.connect = connect;
    this.hooks = hooks;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  subscribe(agent: string, mode: CameraMode): void {
    if (this.ended) return;
    if (this.target === null) {
      this.reset(agent);
    } else if (this.target !== agent) {
      // Keep showing the current agent until the server's hello confirms the new one: a refused
      // retune (rate_limited) must not leave the old feed playing into an empty world.
      this.retune = agent;
    } else {
      this.retune = null;
    }
    this.out({ type: 'subscribe', target_agent_id: agent, mode });
  }

  /** The agent shown now, and the one a retune is waiting for. */
  get current(): { target: string | null; pending: string | null } {
    return { target: this.target, pending: this.retune };
  }

  private reset(agent: string): void {
    this.target = agent;
    this.retune = null;
    this.state = new FeedState();
    this.hooks.onReset(this.state);
  }

  unsubscribe(): void {
    if (this.ended) return;
    this.target = null;
    this.out({ type: 'unsubscribe' });
  }

  close(): void {
    this.ended = true;
    this.sock?.close();
    this.sock = null;
  }

  private out(msg: object): void {
    const text = JSON.stringify(msg);
    if (this.sock === null) {
      const s = this.connect();
      this.sock = s;
      s.onopen = () => {
        this.opened = true;
        for (const t of this.pending) s.send(t);
        this.pending = [];
      };
      s.onmessage = (ev) => this.receive(ev.data);
      s.onclose = () => {
        this.sock = null;
        if (!this.ended) this.end('disconnected');
      };
    }
    if (this.opened) this.sock.send(text);
    else this.pending.push(text);
  }

  private receive(data: unknown): void {
    if (this.ended || typeof data !== 'string') return;
    let msg: KinoFeed;
    try {
      msg = JSON.parse(data) as KinoFeed;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') return;
    // The new target's first message (hello, or target_moved) switches the world over.
    const names =
      msg.type === 'hello' || msg.type === 'target_moved' ? msg.target_agent_id : undefined;
    if (names !== undefined && names !== this.target && names === this.retune) this.reset(names);
    if (msg.type === 'rate_limited' && this.retune !== null && this.target !== null) {
      const refused = this.retune;
      this.retune = null;
      this.hooks.onRetuneRefused?.(this.target, refused);
    }
    const change = this.state.apply(msg);
    this.hooks.onChange(change, this.state);
    if (change.bye !== undefined && change.bye !== 'unsubscribed') this.end(change.bye);
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.sock?.close();
    this.sock = null;
    this.hooks.onEnd(reason);
  }
}
