/**
 * One accepted Thinker connection (Appendix H, threat model section 4). The hub gives the session
 * its identity when the socket is accepted; no frame can name one. The session owns the
 * handshake, the job ledger and the jobs waiting for an answer. It never logs prompt or
 * completion text, only ids, lengths and counts.
 */
import {
  MAX_COMPLETION_TEXT,
  MAX_FRAME_BYTES,
  type ThinkerFrame,
  validateThinkerFrame,
} from '@geldar/contract';
import { tokenMatches } from '@geldar/contract/thinker-token';
import type { RawData, WebSocket } from 'ws';
import { newId } from '../ids.ts';
import { ModelError, type ModelJob } from '../ports/model.ts';
import { JobLedger } from './jobs.ts';

type Frame<T extends ThinkerFrame['type']> = Extract<ThinkerFrame, { type: T }>;

/** What one session needs from its hub. */
export interface SessionContext {
  /** The name the Thinker is welcomed under (`mind.thinker.name`). */
  thinkerName: string;
  /** The model tags the Mind pins; a hello is answered with the offered tags in this set. */
  pinnedModels: ReadonlySet<string>;
  /** Wall clock in milliseconds. */
  now: () => number;
  /** How long a connection may stay silent before `hello`. */
  helloTimeoutMs: number;
  /** When set, a `hello` must carry this token (GELDAR_THINKER_TOKEN_FILE); unset means open. */
  token?: string | undefined;
  log: (line: string) => void;
  /** Called once when the socket has closed. */
  onClosed: (session: ThinkerSession) => void;
  /** Called once when a `hello` has been answered with a `welcome`. */
  onWelcomed?: (session: ThinkerSession) => void;
}

/** What a finished job returns to the client. */
export interface JobResult {
  text: string;
  usageReported?: { promptTokens: number; completionTokens: number };
}

/** The model the Thinker offered in its `hello`. */
export interface OfferedModel {
  maxConcurrent: number;
  maxTokens: number;
}

interface Waiting {
  resolve: (result: JobResult) => void;
  reject: (error: ModelError) => void;
}

/** `ws` closes with this code when a frame is over `maxPayload`. */
const OVERSIZE_ERROR = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';

/** One Thinker connection. */
export class ThinkerSession {
  /** The identity the hub gave this connection, `local-<n>`. */
  readonly id: string;
  readonly ledger: JobLedger;
  /** Inbound frames dropped for being binary, oversize, not JSON, invalid or out of place. */
  droppedFrames = 0;
  state: 'awaiting_hello' | 'ready' | 'closed' = 'awaiting_hello';
  /** The Thinker sent `goodbye`: it takes no more jobs. */
  leaving = false;
  /** Models the Thinker offered and the Mind pins, with the Thinker's limits. */
  readonly accepted = new Map<string, OfferedModel>();
  /** The load the last heartbeat reported, per model. For diagnostics; admission counts its own jobs. */
  reportedLoad: Record<string, number> = {};
  /** Milliseconds of the last `hello` or `heartbeat`. */
  lastSeenMs = 0;
  thinkerVersion = '';
  private readonly waiting = new Map<string, Waiting>();
  private helloTimer: NodeJS.Timeout | undefined;

  private readonly socket: WebSocket;
  private readonly ctx: SessionContext;

  constructor(socket: WebSocket, id: string, ctx: SessionContext) {
    this.socket = socket;
    this.ctx = ctx;
    this.id = id;
    this.ledger = new JobLedger(ctx.now);
    this.lastSeenMs = ctx.now();
    this.helloTimer = setTimeout(() => {
      this.ctx.log(`${this.id}: no hello within ${this.ctx.helloTimeoutMs} ms; closing`);
      this.socket.close(1008, 'hello timeout');
    }, ctx.helloTimeoutMs);
    socket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    socket.on('error', (err: Error & { code?: string }) => {
      if (err.code === OVERSIZE_ERROR) this.drop('frame over the size cap');
    });
    socket.on('close', () => this.onClose());
  }

  /** Total of the ledger's anomalies and the frames that never got that far. */
  get anomalyCount(): number {
    return this.ledger.anomalies + this.droppedFrames;
  }

  /** Whether the last sign of life is no older than `staleAfterMs`. */
  isLive(staleAfterMs: number): boolean {
    return this.ctx.now() - this.lastSeenMs <= staleAfterMs;
  }

  /** Jobs this connection holds for `model`. */
  inFlight(model: string): number {
    return this.ledger.openCount(model);
  }

  /** True when the session is welcomed, not leaving, offers `model` and has a free slot for it. */
  canTake(model: string): boolean {
    const offer = this.accepted.get(model);
    return (
      this.state === 'ready' &&
      !this.leaving &&
      offer !== undefined &&
      this.inFlight(model) < offer.maxConcurrent
    );
  }

  /**
   * Sends one job. The returned promise settles with the Thinker's answer, or rejects with the
   * `ModelError` that {@link cancel}, an `error` frame or a closed socket produced. Throws a
   * `ModelError('internal')` when the job does not make a valid frame, or asks for more tokens than
   * the model's advertised `max_tokens` (the message starts `bad_request`; no such error code exists).
   */
  submit(job: ModelJob): { jobId: string; result: Promise<JobResult> } {
    const offer = this.accepted.get(job.model);
    if (offer !== undefined && job.maxTokens > offer.maxTokens) {
      throw new ModelError(
        'internal',
        `bad_request: max_tokens ${job.maxTokens} is above the ${offer.maxTokens} ${job.model} offers`,
      );
    }
    const jobId = newId('jb');
    const frame = {
      type: 'job',
      job_id: jobId,
      model: job.model,
      messages: job.messages,
      max_tokens: job.maxTokens,
      temperature: job.temperature,
      stop: null,
      deadline: job.deadline.toISOString(),
      cache_hint: { stable_prefix_chars: job.stablePrefixChars },
      ...(job.responseSchema === undefined
        ? {}
        : { response_format: { type: 'json_schema', schema: job.responseSchema } }),
      ...(job.reasoning === undefined ? {} : { reasoning: job.reasoning }),
    };
    const checked = validateThinkerFrame(frame);
    if (!checked.ok) {
      throw new ModelError('internal', `job is not a valid frame: ${checked.errors[0] ?? ''}`);
    }
    const result = new Promise<JobResult>((resolve, reject) => {
      this.waiting.set(jobId, { resolve, reject });
    });
    this.ledger.issue(jobId, job.model, job.deadline.getTime());
    this.sendRaw(frame);
    return { jobId, result };
  }

  /** Tells the Thinker to stop `jobId` and rejects the waiting call with `why`. */
  cancel(jobId: string, why: ModelError): void {
    const waiting = this.waiting.get(jobId);
    if (waiting === undefined) return;
    this.waiting.delete(jobId);
    this.ledger.cancel(jobId);
    this.sendRaw({ type: 'cancel', job_id: jobId });
    waiting.reject(why);
  }

  /** Asks the Thinker to reconnect after a delay, then closes. Resolves once the socket is gone. */
  async drainAndClose(reconnectAfterSeconds: number): Promise<void> {
    if (this.state === 'closed') return;
    this.sendRaw({ type: 'drain', reconnect_after_seconds: reconnectAfterSeconds });
    await this.close(1001, 'hub stopping');
  }

  /** Closes the socket, waiting at most two seconds for the close handshake. */
  close(code = 1000, reason = ''): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 2000);
      timer.unref();
      this.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(code, reason);
    });
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.drop('binary frame');
      return;
    }
    const text = rawToString(data);
    if (Buffer.byteLength(text) > MAX_FRAME_BYTES) {
      this.drop('frame over the size cap');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.drop('not JSON');
      return;
    }
    const checked = validateThinkerFrame(json);
    if (!checked.ok) {
      this.drop(`invalid frame: ${JSON.stringify((checked.errors[0] ?? 'unknown').slice(0, 120))}`);
      return;
    }
    const frame = checked.value;
    if (this.state === 'awaiting_hello') {
      if (frame.type === 'hello') this.onHello(frame);
      else this.drop(`${frame.type} before hello`);
      return;
    }
    switch (frame.type) {
      case 'hello':
        this.drop('a second hello');
        this.ctx.log(`${this.id}: second hello; closing`);
        this.socket.close(1008, 'second hello');
        return;
      case 'heartbeat':
        this.lastSeenMs = this.ctx.now();
        this.reportedLoad = frame.load;
        return;
      case 'completion':
        this.onAnswer(frame);
        return;
      case 'error':
        this.onAnswer(frame);
        return;
      case 'goodbye':
        this.leaving = true;
        this.ctx.log(`${this.id}: goodbye (${frame.reason})`);
        return;
      default:
        this.drop(`${frame.type} is not a Thinker frame`);
    }
  }

  private onHello(frame: Frame<'hello'>): void {
    clearTimeout(this.helloTimer);
    if (this.ctx.token !== undefined && !tokenMatches(this.ctx.token, frame.token)) {
      // Never the offered token, never the expected one: the line says only that it was refused.
      this.ctx.log(`${this.id}: refused on hello, token missing or wrong`);
      this.socket.close(1008, 'unauthorized');
      return;
    }
    this.state = 'ready';
    this.lastSeenMs = this.ctx.now();
    this.thinkerVersion = frame.thinker_version;
    for (const offer of frame.models) {
      if (!this.ctx.pinnedModels.has(offer.name)) continue;
      this.accepted.set(offer.name, {
        maxConcurrent: offer.max_concurrent,
        maxTokens: offer.max_tokens,
      });
    }
    this.sendRaw({
      type: 'welcome',
      thinker: this.ctx.thinkerName,
      accepted_models: [...this.accepted.keys()],
      server_time: new Date(this.ctx.now()).toISOString(),
    });
    this.ctx.log(`${this.id}: welcomed, ${this.accepted.size} of ${frame.models.length} models`);
    this.ctx.onWelcomed?.(this);
  }

  private onAnswer(frame: Frame<'completion'> | Frame<'error'>): void {
    const claim = this.ledger.claim(frame.job_id);
    if (claim !== 'accepted') {
      this.ctx.log(
        `${this.id}: dropped a ${frame.type} (${claim}); anomalies ${this.ledger.anomalies}`,
      );
      return;
    }
    const waiting = this.waiting.get(frame.job_id);
    if (waiting === undefined) return;
    this.waiting.delete(frame.job_id);
    if (frame.type === 'error') {
      waiting.reject(
        new ModelError(frame.code, `the Thinker reported ${frame.code}: ${frame.message}`),
      );
      return;
    }
    // The schema caps characters; the cap in bytes is the stricter reading (Appendix H).
    if (Buffer.byteLength(frame.text) > MAX_COMPLETION_TEXT) {
      waiting.reject(new ModelError('internal', 'completion over 32 KiB'));
      this.ledger.anomalies += 1;
      return;
    }
    const usage = frame.usage_reported;
    waiting.resolve({
      text: frame.text,
      ...(usage === undefined
        ? {}
        : {
            usageReported: {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
            },
          }),
    });
  }

  private onClose(): void {
    clearTimeout(this.helloTimer);
    this.state = 'closed';
    for (const waiting of this.waiting.values()) {
      waiting.reject(new ModelError('internal', 'the Thinker disconnected'));
    }
    this.waiting.clear();
    this.ctx.onClosed(this);
  }

  private drop(why: string): void {
    this.droppedFrames += 1;
    this.ctx.log(`${this.id}: dropped an inbound frame (${why}); total ${this.droppedFrames}`);
  }

  /** Validates an outbound frame and sends it; an invalid or unsendable one is not sent. */
  private sendRaw(frame: unknown): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    const checked = validateThinkerFrame(frame);
    if (!checked.ok) {
      this.ctx.log(`${this.id}: refused to send an invalid frame: ${checked.errors[0] ?? ''}`);
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
