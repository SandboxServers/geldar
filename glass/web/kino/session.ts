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

/** A subscribe the server answered with rate_limited, as far as the session can tell which one it was. */
export type Refusal =
  /** A change of agent: the monitor keeps showing `kept`. */
  | { kind: 'retune'; kept: string; refused: string }
  /** The first subscribe on this connection: nothing is playing yet. */
  | { kind: 'open'; agent: string }
  /** A change of camera mode for the agent already shown (an audit row only; the picture is unchanged). */
  | { kind: 'mode' };

export interface SessionHooks {
  /** A fresh world for `agent`: the view drops the old scene. */
  onReset(state: FeedState, agent: string): void;
  onChange(change: FeedChange, state: FeedState): void;
  /** The server refused a subscribe (rate_limited). */
  onRefused?(refusal: Refusal): void;
  /** The server ended the feed (`bye` reason), or the socket dropped (`disconnected`). */
  onEnd(reason: string): void;
}

/** Where a session stands: the agent whose world is on screen, whether the server has named it, and the agent last asked for. */
export interface SessionView {
  shown: string | null;
  confirmed: boolean;
  wanted: string | null;
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

/**
 * The session's picture follows what the server says it is sending (decision 0166): a hello or
 * target_moved naming another agent starts a fresh world, so two agents' worlds never mix, whatever
 * order retunes and refusals arrive in. A retune keeps the old world on screen until then.
 */
export class KinoSession {
  private sock: SocketLike | null = null;
  private opened = false;
  private ended = false;
  private pending: string[] = [];
  private state = new FeedState();
  private readonly connect: () => SocketLike;
  private readonly hooks: SessionHooks;
  /** The agent whose world is on screen. */
  private shown: string | null = null;
  /** True once the server has named `shown` (hello or target_moved). */
  private confirmed = false;
  /** The agent last asked for. */
  private wanted: string | null = null;

  constructor(connect: () => SocketLike, hooks: SessionHooks) {
    this.connect = connect;
    this.hooks = hooks;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  subscribe(agent: string, mode: CameraMode): void {
    if (this.ended) return;
    // The first agent gets its world at once; a later one waits for the server to name it.
    if (this.shown === null) this.reset(agent, false);
    this.wanted = agent;
    this.out({ type: 'subscribe', target_agent_id: agent, mode });
  }

  get current(): SessionView {
    return { shown: this.shown, confirmed: this.confirmed, wanted: this.wanted };
  }

  private reset(agent: string, confirmed: boolean): void {
    this.shown = agent;
    this.confirmed = confirmed;
    this.state = new FeedState();
    this.state.target = agent;
    this.hooks.onReset(this.state, agent);
  }

  unsubscribe(): void {
    if (this.ended) return;
    this.shown = null;
    this.confirmed = false;
    this.wanted = null;
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
    // The server names the agent it is sending (hello, or target_moved): another agent means another world.
    const names =
      msg.type === 'hello' || msg.type === 'target_moved' ? msg.target_agent_id : undefined;
    if (names !== undefined) {
      if (names !== this.shown) {
        const waiting = this.wanted !== null && this.wanted !== this.shown;
        this.reset(names, true);
        // Nothing else asked for: the server's agent is now the one wanted (a refusal was misread).
        if (!waiting) this.wanted = names;
      } else this.confirmed = true;
    }
    if (msg.type === 'rate_limited') this.refused();
    const change = this.state.apply(msg);
    this.hooks.onChange(change, this.state);
    if (change.bye !== undefined && change.bye !== 'unsubscribed') this.end(change.bye);
  }

  /**
   * rate_limited does not say which subscribe it refuses. A change of agent still waiting is the likely
   * one; a wrong guess heals itself, because the picture follows the server's hello, not the guess.
   */
  private refused(): void {
    if (this.shown === null) return;
    if (this.wanted !== null && this.wanted !== this.shown) {
      const refused = this.wanted;
      this.wanted = this.shown;
      this.hooks.onRefused?.({ kind: 'retune', kept: this.shown, refused });
    } else if (!this.confirmed) this.hooks.onRefused?.({ kind: 'open', agent: this.shown });
    else this.hooks.onRefused?.({ kind: 'mode' });
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.sock?.close();
    this.sock = null;
    this.hooks.onEnd(reason);
  }
}
