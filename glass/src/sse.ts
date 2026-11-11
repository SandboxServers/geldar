/**
 * The thought stream over Server-Sent Events. One shared poll reads new thoughts for every client,
 * so the database is queried once per tick however many humans are watching. Limits:
 *  - at most `maxClients` open streams; the next one is refused (the caller sends 503);
 *  - at most `bufferFrames` queued frames per client; a slow client loses its oldest frame;
 *  - one heartbeat comment per `heartbeatMs` per client, so proxies keep the stream open;
 *  - the timers run only while a client is attached, and the poll never overlaps itself.
 */
import type { ServerResponse } from 'node:http';
import type { Row, ThoughtCursor } from './query.ts';

export interface SseOptions {
  maxClients: number;
  bufferFrames: number;
  pollMs: number;
  heartbeatMs: number;
  /** The cursor a new stream starts from: thoughts after this moment are new. */
  start: () => Promise<ThoughtCursor>;
  /** Thoughts after a cursor, oldest first. Each row carries `cursor_at` and `thought_id`. */
  fetch: (after: ThoughtCursor) => Promise<Row[]>;
  /** False: the next heartbeat ends every stream (the kill switch, 0072 item 6). Left out: always on. */
  enabled?: () => boolean;
  /** Receives one line per poll error at most once a minute: the event name and a sanitized error code. */
  log?: (entry: { event: 'glass_poll_error'; code: string }) => void;
}

/** At most one `glass_poll_error` line per this many milliseconds. */
const ERROR_LOG_MS = 60_000;

export interface SseStats {
  clients: number;
  delivered: number;
  dropped: number;
  rejected: number;
  polls: number;
  pollErrors: number;
}

interface Client {
  res: ServerResponse;
  queue: string[];
  waiting: boolean;
  closed: boolean;
}

/** An SSE field value on one line: a CR, LF or NUL in it would end the line or the field early, so it is removed. */
function sseField(value: string): string {
  return value.replace(/[\r\n\0]/g, '');
}

/** A database or network error code when it is a plain token; anything else is 'unknown'. */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : 'unknown';
}

/** The SSE body for one thought: the row without its cursor column, JSON on one data line. */
function thoughtFrame(row: Row): string {
  const { cursor_at: _cursor, ...payload } = row;
  const id = sseField(String(row.thought_id ?? ''));
  return `event: thought\nid: ${id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export class SseHub {
  private readonly clients = new Set<Client>();
  private readonly counters = { delivered: 0, dropped: 0, rejected: 0, polls: 0, pollErrors: 0 };
  private cursor: ThoughtCursor | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** Bumped when the hub stops, so a poll that was in flight cannot deliver to a later stream. */
  private generation = 0;
  private lastErrorLogMs = Number.NEGATIVE_INFINITY;

  private readonly options: SseOptions;

  constructor(options: SseOptions) {
    this.options = options;
  }

  /**
   * Opens a stream on `res`. Returns false, and writes nothing, when the cap is reached. The
   * caller has set the response headers that apply to every response.
   */
  attach(res: ServerResponse): boolean {
    if (this.clients.size >= this.options.maxClients) {
      this.counters.rejected += 1;
      return false;
    }
    const client: Client = { res, queue: [], waiting: false, closed: false };
    this.clients.add(client);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    res.on('close', () => this.detach(client));
    res.on('error', () => this.detach(client));
    if (this.clients.size === 1) this.start();
    return true;
  }

  stats(): SseStats {
    return { clients: this.clients.size, ...this.counters };
  }

  /** Ends every stream and stops the timers. Used on shutdown. */
  close(): void {
    for (const client of [...this.clients]) {
      this.detach(client);
      if (!client.res.writableEnded) client.res.end();
    }
  }

  private start(): void {
    this.cursor = null;
    this.pollTimer = setInterval(() => void this.poll(), this.options.pollMs);
    this.beatTimer = setInterval(() => this.heartbeat(), this.options.heartbeatMs);
  }

  private stop(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.beatTimer !== null) clearInterval(this.beatTimer);
    this.pollTimer = null;
    this.beatTimer = null;
    this.cursor = null;
    this.generation += 1;
  }

  private detach(client: Client): void {
    if (!this.clients.delete(client)) return;
    client.closed = true;
    client.queue.length = 0;
    if (this.clients.size === 0) this.stop();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const generation = this.generation;
    this.counters.polls += 1;
    try {
      const from = this.cursor ?? (await this.options.start());
      const rows = await this.options.fetch(from);
      if (generation !== this.generation) return;
      this.cursor = from;
      for (const row of rows) {
        this.broadcast(thoughtFrame(row));
        this.cursor = { at: String(row.cursor_at ?? ''), id: String(row.thought_id ?? '') };
      }
    } catch (err) {
      // The error text can name the database, so only its code is logged, and not more than once a minute.
      if (generation === this.generation) {
        this.counters.pollErrors += 1;
        this.logPollError(err);
      }
    } finally {
      this.polling = false;
    }
  }

  private logPollError(err: unknown): void {
    const { log } = this.options;
    const now = Date.now();
    if (log === undefined || now - this.lastErrorLogMs < ERROR_LOG_MS) return;
    this.lastErrorLogMs = now;
    log({ event: 'glass_poll_error', code: errorCode(err) });
  }

  private heartbeat(): void {
    if (this.options.enabled?.() === false) {
      this.close();
      return;
    }
    this.broadcast(': heartbeat\n\n');
  }

  private broadcast(frame: string): void {
    for (const client of this.clients) {
      if (client.queue.length >= this.options.bufferFrames) {
        client.queue.shift();
        this.counters.dropped += 1;
      }
      client.queue.push(frame);
      this.flush(client);
    }
  }

  /** Writes queued frames until the socket asks to pause, then waits for its drain event. */
  private flush(client: Client): void {
    while (!client.closed && !client.waiting && client.queue.length > 0) {
      const frame = client.queue.shift() ?? '';
      this.counters.delivered += 1;
      if (!client.res.write(frame)) {
        client.waiting = true;
        client.res.once('drain', () => {
          client.waiting = false;
          this.flush(client);
        });
      }
    }
  }
}
