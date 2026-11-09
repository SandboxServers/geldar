/**
 * The local Thinker hub: the Appendix H server for Phase 0 (threat model section 3, "Local Thinker
 * WebSocket"). It listens on loopback with no auth; each accepted socket gets its identity here,
 * never from a frame, so the later mTLS wrapper changes the transport and not the messages.
 */
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { AnimusConfig } from '../config.ts';
import { ThinkerSession } from './session.ts';

/** The WebSocket path of Appendix H. */
export const THINKER_PATH = '/v1/thinker/stream';

/** Frames and sockets bigger than this are refused (Appendix H: 1 MiB). */
export const MAX_PAYLOAD = 1024 * 1024;

/** Options of the hub. Everything but the config has the Appendix H or card default. */
export interface HubOptions {
  /** `mind.thinker` (host, port, name) and the model pins. */
  config: Pick<AnimusConfig, 'thinker' | 'modelPins'>;
  /** Overrides `config.thinker.port`; tests pass 0 for any free port. */
  port?: number;
  helloTimeoutMs?: number;
  /** A connection silent for longer than this is down (Appendix H heartbeat is 15 s). */
  staleAfterMs?: number;
  /** The reconnect delay `stop()` hands to Thinkers in the `drain` frame. */
  drainReconnectS?: number;
  /** Connections beyond this are closed at once. */
  maxConnections?: number;
  now?: () => number;
  /** Called when a Thinker has been welcomed (with the models accepted) and when it is gone. */
  onThinker?: (event: { kind: 'connected' | 'disconnected'; id: string; models: string[] }) => void;
  /** One line per event: ids, lengths and counts only, never prompt or completion text. */
  log?: (line: string) => void;
}

/** A read-only view of one connection for logs and tests. */
export interface SessionStats {
  id: string;
  state: ThinkerSession['state'];
  models: string[];
  anomalies: number;
  droppedFrames: number;
  crossedCancel: number;
}

/** The server half of Appendix H. */
export class ThinkerHub {
  private readonly opts: Required<Omit<HubOptions, 'port' | 'log' | 'onThinker'>> & {
    log: (l: string) => void;
  };
  private readonly onThinker: NonNullable<HubOptions['onThinker']>;
  private readonly listenPort: number;
  private readonly sessions = new Map<string, ThinkerSession>();
  /** The sessions that were welcomed, with their models, for the disconnect report. */
  private readonly welcomed = new Map<string, string[]>();
  private readonly waiters = new Set<{ model: string; done: (connected: boolean) => void }>();
  private server: WebSocketServer | null = null;
  private counter = 0;

  constructor(options: HubOptions) {
    this.opts = {
      helloTimeoutMs: 10_000,
      staleAfterMs: 45_000,
      drainReconnectS: 5,
      maxConnections: 8,
      now: Date.now,
      log: () => {},
      ...options,
    };
    this.onThinker = options.onThinker ?? (() => {});
    this.listenPort = options.port ?? options.config.thinker.port;
  }

  /**
   * Resolves true once a live Thinker offers `model` (at once when one does), false after
   * `timeoutMs` or when `signal` aborts.
   */
  waitForThinker(model: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.pick(model) !== undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = {
        model,
        done: (connected: boolean): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.waiters.delete(waiter);
          resolve(connected);
        },
      };
      const onAbort = (): void => waiter.done(false);
      const timer = setTimeout(() => waiter.done(false), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else this.waiters.add(waiter);
    });
  }

  /** The port the server listens on; valid after {@link start}. */
  get port(): number {
    if (this.server === null) throw new Error('the Thinker hub is not started');
    return (this.server.address() as AddressInfo).port;
  }

  /** Starts listening. Resolves once the socket is bound. */
  async start(): Promise<void> {
    if (this.server !== null) return;
    const server = new WebSocketServer({
      host: this.opts.config.thinker.host,
      port: this.listenPort,
      path: THINKER_PATH,
      maxPayload: MAX_PAYLOAD,
      // A Thinker is a Node process and sends no Origin; a web page reaching loopback does.
      verifyClient: (info: { origin?: string }) => !info.origin,
    });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    server.on('error', (err) => this.opts.log(`hub error: ${err.message}`));
    server.on('connection', (socket) => {
      const id = `local-${++this.counter}`;
      if (this.sessions.size >= this.opts.maxConnections) {
        this.opts.log(`${id}: refused, too many connections`);
        socket.close(1013, 'too many connections');
        return;
      }
      const session = new ThinkerSession(socket, id, {
        thinkerName: this.opts.config.thinker.name,
        pinnedModels: new Set(Object.keys(this.opts.config.modelPins)),
        now: this.opts.now,
        helloTimeoutMs: this.opts.helloTimeoutMs,
        log: this.opts.log,
        onClosed: (closed) => {
          this.sessions.delete(closed.id);
          const models = this.welcomed.get(closed.id);
          if (models === undefined) return;
          this.welcomed.delete(closed.id);
          this.onThinker({ kind: 'disconnected', id: closed.id, models });
        },
        onWelcomed: (ready) => {
          const models = [...ready.accepted.keys()];
          this.welcomed.set(ready.id, models);
          this.onThinker({ kind: 'connected', id: ready.id, models });
          for (const waiter of [...this.waiters]) {
            if (this.pick(waiter.model) !== undefined) waiter.done(true);
          }
        },
      });
      this.sessions.set(id, session);
      this.opts.log(`${id}: connected`);
    });
    this.server = server;
  }

  /** The Thinker's name, as the welcome frame gives it. */
  get thinkerName(): string {
    return this.opts.config.thinker.name;
  }

  /** The staleness limit, for the client's pick. */
  get staleAfterMs(): number {
    return this.opts.staleAfterMs;
  }

  /**
   * The live connection to give a job for `model`: welcomed, heartbeat fresh, offering the model,
   * with a free slot. The least loaded wins; undefined when there is none.
   */
  pick(model: string): ThinkerSession | undefined {
    let best: ThinkerSession | undefined;
    for (const session of this.sessions.values()) {
      if (!session.canTake(model) || !session.isLive(this.opts.staleAfterMs)) continue;
      if (best === undefined || session.inFlight(model) < best.inFlight(model)) best = session;
    }
    return best;
  }

  /** The connections as they are now. */
  stats(): SessionStats[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      state: s.state,
      models: [...s.accepted.keys()],
      anomalies: s.anomalyCount,
      droppedFrames: s.droppedFrames,
      crossedCancel: s.ledger.crossedCancel,
    }));
  }

  /** The session with this id, if connected. */
  session(id: string): ThinkerSession | undefined {
    return this.sessions.get(id);
  }

  /** Sends `drain` to every Thinker, closes the connections and stops listening. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    this.server = null;
    await Promise.all(
      [...this.sessions.values()].map((s) => s.drainAndClose(this.opts.drainReconnectS)),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
