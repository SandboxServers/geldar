import { EventEmitter } from 'node:events';
import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import { watchRecipeBook } from './actions/craft-table.ts';
import { nextDelayMs } from './backoff.ts';
import { stackVersions } from './versions.ts';

/** Where a bot connects and how it reconnects. Production passes host and port from `loadConfig` only. */
export interface ConnectionOptions {
  host: string;
  port: number;
  username: string;
  /** The Minecraft version to join as. Default `26.1`. */
  version?: string;
  /** Injectable for tests; the default is `mineflayer.createBot`. */
  createBot?: (o: BotOptions) => Bot;
  /**
   * Waits `ms` before a reconnect. The signal aborts on `stop()`, and a sleep that honours it ends
   * at once. Default: a timer that is cleared on abort.
   */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  rng?: () => number;
  /** A session shorter than this does not reset the attempt counter. Default 10 000 ms. */
  stableMs?: number;
  /** Default: one JSON line to the console. */
  log?: (line: Record<string, unknown>) => void;
}

/** Where the manager is: `idle` before `start()`, `connecting` and `online` while a bot is up. */
export type ConnectionState = 'idle' | 'connecting' | 'online' | 'backoff' | 'stopped' | 'fatal';

interface SessionEnd {
  reason: string;
  /** True when the server sent a kick; a kick is the only end that can be fatal. */
  kicked: boolean;
  /** When the first spawn of this session happened, or null if it never spawned. */
  spawnedAt: number | null;
}

const DEFAULT_VERSION = '26.1';
const DEFAULT_STABLE_MS = 10_000;
/** A kick for a permanent refusal: retrying cannot succeed, so the connection goes fatal. */
const PERMANENT_REFUSAL = /whitelist|banned/i;

/**
 * Resolves after `ms`, or at once when `signal` aborts. Either way the timer and the abort
 * listener are released, so a stopped manager leaves nothing behind.
 */
const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

const defaultLog = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify(line));
};

/**
 * A kick reason as text. Mineflayer passes the packet's reason through untouched, and on newer
 * protocols that can be a parsed component object rather than a string.
 */
function reasonText(value: unknown): string {
  if (typeof value === 'string') return value;
  const json = JSON.stringify(value) as string | undefined;
  return json ?? String(value);
}

/**
 * Keeps one bot connected: joins, and on a disconnect waits `nextDelayMs(attempt)` and joins
 * again, until `stop()`. Events: `spawn`(bot), `disconnect`({ reason }), `retry`({ attempt,
 * delayMs }), `fatal`({ reason }).
 */
export class ConnectionManager extends EventEmitter {
  /** Where the manager is now; see `ConnectionState`. */
  state: ConnectionState = 'idle';
  /** The bot of the current or most recent session, or null before the first one. */
  bot: Bot | null = null;
  /** Consecutive failed sessions; 0 right after a stable session. */
  attempt = 0;
  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private readonly version: string;
  private readonly createBot: (o: BotOptions) => Bot;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly stableMs: number;
  private readonly log: (line: Record<string, unknown>) => void;
  /** Aborted by stop() so a pending backoff sleep ends at once. */
  private readonly stopController = new AbortController();
  private pending: { resolve: (bot: Bot) => void; reject: (err: Error) => void } | null = null;

  constructor(options: ConnectionOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.username = options.username;
    this.version = options.version ?? DEFAULT_VERSION;
    this.createBot = options.createBot ?? ((o) => mineflayer.createBot(o));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
    this.log = options.log ?? defaultLog;
  }

  /** Joins and resolves on the first spawn. Rejects if the connection goes fatal before that. */
  start(): Promise<Bot> {
    if (this.state !== 'idle') {
      return Promise.reject(new Error(`connection already ${this.state}`));
    }
    this.log({ event: 'start', ...stackVersions(), requestedVersion: this.version });
    const joined = new Promise<Bot>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    this.run().catch((err: unknown) => {
      this.fail(err instanceof Error ? err.message : String(err));
    });
    return joined;
  }

  /** No more retries; cancels a pending backoff; quits the current bot. */
  async stop(): Promise<void> {
    if (this.state === 'fatal' || this.state === 'stopped') return;
    this.state = 'stopped';
    this.stopController.abort();
    this.pending?.reject(new Error('connection stopped before the first spawn'));
    this.pending = null;
    this.bot?.quit();
  }

  /** Joins, waits for the session to end, backs off, and repeats until stopped or fatal. */
  private async run(): Promise<void> {
    for (;;) {
      const end = await this.session();
      if (this.state === 'stopped' || this.state === 'fatal') return;
      this.emit('disconnect', { reason: end.reason });
      if (end.kicked && PERMANENT_REFUSAL.test(end.reason)) {
        this.fail(end.reason);
        return;
      }
      // A session that stayed up long enough counts as healthy: the next failure starts over.
      if (end.spawnedAt !== null && this.now() - end.spawnedAt >= this.stableMs) this.attempt = 0;
      this.attempt += 1;
      const delayMs = nextDelayMs(this.attempt, undefined, this.rng);
      this.state = 'backoff';
      this.emit('retry', { attempt: this.attempt, delayMs });
      this.log({ event: 'retry', attempt: this.attempt, delayMs, reason: end.reason });
      await this.sleep(delayMs, this.stopController.signal);
      if (this.isStopped()) return;
      this.state = 'connecting';
    }
  }

  /** One bot from creation to its end: resolves once, on the first `end` or `kicked`. */
  private session(): Promise<SessionEnd> {
    const bot = this.createBot({
      host: this.host,
      port: this.port,
      username: this.username,
      auth: 'offline',
      version: this.version,
      hideErrors: false,
    });
    this.bot = bot;
    // Before any packet: the server sends the recipe book during the join.
    watchRecipeBook(bot);
    this.state = 'connecting';
    return new Promise((resolve) => {
      let spawnedAt: number | null = null;
      let done = false;
      // A kick is followed by an `end`; the first one settles the session and the other is ignored.
      const finish = (reason: string, kicked: boolean): void => {
        if (done) return;
        done = true;
        resolve({ reason, kicked, spawnedAt });
      };
      bot.on('spawn', () => {
        // Death and dimension changes spawn again inside the same session: only the first counts.
        if (spawnedAt !== null) return;
        spawnedAt = this.now();
        if (this.state === 'stopped') return;
        this.state = 'online';
        this.emit('spawn', bot);
        this.pending?.resolve(bot);
        this.pending = null;
      });
      bot.on('kicked', (reason: unknown) => finish(reasonText(reason), true));
      bot.on('end', (reason?: string) => finish(reason ?? 'end', false));
      // Protocol errors are logged, not thrown: an unhandled 'error' event would crash the process.
      bot.on('error', (err: unknown) => {
        this.log({ event: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  /** A method call, not a state comparison, so TypeScript does not narrow `state` across the await. */
  private isStopped(): boolean {
    return this.state === 'stopped';
  }

  private fail(reason: string): void {
    this.state = 'fatal';
    this.log({ event: 'fatal', reason });
    this.emit('fatal', { reason });
    this.pending?.reject(new Error(`connection failed for good: ${reason}`));
    this.pending = null;
  }
}
