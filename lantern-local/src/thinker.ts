import { MAX_COMPLETION_TEXT, MAX_FRAME_BYTES, validateThinkerFrame } from '@geldar/contract';
import type { AdvertisedModel } from './models.ts';
import { type ChatFn, OllamaError, type OllamaErrorCode, type WarmFn } from './ollama.ts';

/**
 * The advertised `max_tokens` of every model: the schema caps a job at 32768; the Mind asks at most
 * 1200 (the sleep reflection, `shards/phase0.yaml`), so this must stay at or above that.
 */
export const ADVERTISED_MAX_TOKENS = 2048;

/** How long before a job's deadline the timeout is sent, so the Mind receives it in time. */
export const TIMEOUT_MARGIN_MS = 500;

/** Longest text of a log line that echoes a peer's frame; longer text is cut and JSON-escaped. */
const LOG_TEXT_CHARS = 120;

/** A peer-supplied string as one log field: JSON-escaped (no raw newlines), cut to a fixed length. */
export function logText(text: string): string {
  return JSON.stringify(text).slice(0, LOG_TEXT_CHARS);
}

/** The first reconnect delay and its cap: a hub that starts late is found within seconds. */
export const DEFAULT_BACKOFF_INITIAL_MS = 250;
export const DEFAULT_BACKOFF_MAX_MS = 5000;

/** The time one pinned model may take to load in its warm-up; a cold 32B load from disk takes minutes. */
export const DEFAULT_WARM_TIMEOUT_MS = 180_000;

/** The delay before a reconnect: `baseMs` less up to half of it at random, so Thinkers do not step together. */
export function jitteredDelay(baseMs: number, random: () => number): number {
  return Math.floor(baseMs * (0.5 + 0.5 * random()));
}

export interface ThinkerOptions {
  wsUrl: string;
  models: AdvertisedModel[];
  chat: ChatFn;
  /**
   * Loads each pinned model before `hello`, one at a time. Without it no warm-up runs and every
   * pinned model is advertised at once.
   */
  warm?: WarmFn;
  /**
   * The names to warm, in order: the run tier's model, then any others. Without it every model is
   * warmed in `models` order. A name that is not in `models` is skipped.
   */
  warmNames?: string[];
  /**
   * Re-checks the pinned digests against Ollama before each dial and returns the names still
   * matching. Without it the start-up check stands for the life of the process.
   */
  recheck?: () => Promise<string[]>;
  version: string;
  heartbeatMs?: number;
  /** How long to wait for `welcome` after `hello`. Appendix H and the card say 10 s. */
  helloTimeoutMs?: number;
  /** How long each pinned model's warm-up call may take before the model is left unadvertised. */
  warmTimeoutMs?: number;
  /** Reconnect backoff: first delay and the cap; it doubles each failed attempt. */
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  /** Source of the jitter in [0, 1); defaults to `Math.random`. */
  random?: () => number;
  /** Receives one line per event: ids, lengths and timings only, never prompt or completion text. */
  log?: (line: string) => void;
}

interface InFlight {
  model: string;
  controller: AbortController;
  /** Set when the abort is the deadline timer rather than a cancel or a disconnect. */
  timedOut: boolean;
}

const encoder = new TextEncoder();

/** The local Thinker: one WebSocket to the Mind, jobs served from Ollama (Appendix H). */
export class LocalThinker {
  /** Inbound frames that failed validation or arrived in the wrong state, and were dropped. */
  droppedFrames = 0;
  /** How many `welcome` frames this Thinker has accepted, across reconnects. */
  welcomes = 0;

  private readonly opts: Required<
    Omit<ThinkerOptions, 'log' | 'warm' | 'warmNames' | 'recheck'>
  > & {
    log: (line: string) => void;
    warm?: WarmFn;
    warmNames?: string[];
    recheck?: () => Promise<string[]>;
  };
  private readonly byName = new Map<string, AdvertisedModel>();
  private readonly inFlight = new Map<string, InFlight>();
  /** The models that answered their warm-up on the latest attempt: the ones `hello` advertises. */
  private advertised: AdvertisedModel[] = [];
  /** The models that answered the warm-up, once every pinned name has answered: the process warms only once. */
  private warmed: AdvertisedModel[] | undefined;
  private socket: WebSocket | null = null;
  private serving = false;
  private accepted = new Set<string>();
  private stopped = false;
  private warmAbort: AbortController | undefined;
  private backoffMs: number;
  private helloTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private nextDelayMs: number | undefined;

  constructor(options: ThinkerOptions) {
    this.opts = {
      heartbeatMs: 15_000,
      helloTimeoutMs: 10_000,
      warmTimeoutMs: DEFAULT_WARM_TIMEOUT_MS,
      backoffInitialMs: DEFAULT_BACKOFF_INITIAL_MS,
      backoffMaxMs: DEFAULT_BACKOFF_MAX_MS,
      random: Math.random,
      log: () => {},
      ...options,
    };
    this.backoffMs = this.opts.backoffInitialMs;
    for (const model of options.models) this.byName.set(model.name, model);
  }

  /** Starts the connection loop; it keeps reconnecting until {@link stop}. */
  start(): void {
    void this.connect();
  }

  /** Sends `goodbye{shutdown}` if connected, then closes and stops reconnecting. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.warmAbort?.abort();
    const socket = this.socket;
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      this.send({ type: 'goodbye', reason: 'shutdown' });
      await new Promise<void>((resolve) => {
        socket.addEventListener('close', () => resolve());
        socket.close(1000, 'shutdown');
        setTimeout(resolve, 2000).unref();
      });
    }
    this.teardown();
  }

  /**
   * One connection attempt: warms the pinned models until every name has answered, re-checks their
   * digests, then dials the Mind with the ones that still match. A partial warm-up is advertised on
   * this dial only, and the next dial warms the names again.
   */
  private async connect(): Promise<void> {
    if (this.stopped) return;
    let warmed = this.warmed;
    if (warmed === undefined) {
      const attempt = await this.warmModels();
      if (this.stopped) return;
      if (attempt.warmed.length === 0) {
        this.opts.log('no pinned model warmed; advertising nothing and retrying');
        this.scheduleReconnect();
        return;
      }
      if (attempt.complete) this.warmed = attempt.warmed;
      warmed = attempt.warmed;
    }
    if (this.opts.recheck === undefined) {
      this.advertised = warmed;
    } else {
      let current: string[];
      try {
        current = await this.opts.recheck();
      } catch (err) {
        this.opts.log(`digest re-check failed: ${err instanceof Error ? err.message : 'unknown'}`);
        this.scheduleReconnect();
        return;
      }
      if (this.stopped) return;
      this.advertised = warmed.filter((m) => current.includes(m.name));
      if (this.advertised.length === 0) {
        this.opts.log('no warmed model still matches its pinned digest; retrying');
        this.scheduleReconnect();
        return;
      }
    }
    this.dial();
  }

  /** Loads the pinned models in turn with a one-token call; returns the ones that answered in time. */
  private async warmModels(): Promise<{ warmed: AdvertisedModel[]; complete: boolean }> {
    const warm = this.opts.warm;
    const names = this.opts.warmNames ?? this.opts.models.map((m) => m.name);
    const order = names.flatMap((name) => this.opts.models.filter((m) => m.name === name));
    if (warm === undefined) return { warmed: order, complete: true };
    const warmed: AdvertisedModel[] = [];
    for (const pin of order) {
      if (this.stopped) break;
      this.opts.log(`warming ${pin.name}`);
      const started = Date.now();
      const controller = new AbortController();
      this.warmAbort = controller;
      const timer = setTimeout(() => controller.abort(), this.opts.warmTimeoutMs);
      try {
        await warm(pin, controller.signal);
        this.opts.log(`warm ${pin.name} in ${Date.now() - started} ms`);
        warmed.push(pin);
      } catch (err) {
        let reason = 'unexpected failure';
        if (this.stopped) reason = 'stopped';
        else if (controller.signal.aborted) {
          reason = `no answer within ${this.opts.warmTimeoutMs} ms`;
        } else if (err instanceof OllamaError) reason = err.message;
        this.opts.log(`warm failed ${pin.name}: ${reason}`);
      } finally {
        clearTimeout(timer);
      }
    }
    this.warmAbort = undefined;
    return { warmed, complete: warmed.length === order.length };
  }

  private dial(): void {
    if (this.stopped) return;
    this.opts.log(`connecting to ${this.opts.wsUrl}`);
    const socket = new WebSocket(this.opts.wsUrl);
    this.socket = socket;
    this.serving = false;
    socket.addEventListener('open', () => {
      this.opts.log(`connected; sending hello with ${this.advertised.length} model(s)`);
      this.send({
        type: 'hello',
        thinker_version: this.opts.version,
        models: this.advertised.map((m) => ({
          name: m.name,
          max_concurrent: m.maxConcurrent,
          max_tokens: ADVERTISED_MAX_TOKENS,
        })),
      });
      this.helloTimer = setTimeout(() => {
        this.opts.log('no welcome within the hello timeout; reconnecting');
        socket.close();
      }, this.opts.helloTimeoutMs);
    });
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.onMessage(event.data);
    });
    // A refused connection raises `error` and, on Node 22, no `close`: the attempt ends on either.
    let ended = false;
    const end = (what: string): void => {
      if (ended || socket !== this.socket) return;
      ended = true;
      this.opts.log(`${what} (${this.serving ? 'was welcomed' : 'never welcomed'})`);
      this.teardown();
      this.scheduleReconnect();
    };
    socket.addEventListener('error', (event) => {
      const message = (event as { message?: unknown }).message;
      const text = typeof message === 'string' ? message : 'unknown';
      this.opts.log(`socket error: ${text}`);
      if (socket.readyState !== WebSocket.OPEN) end('connection failed');
    });
    socket.addEventListener('close', (event) => {
      end(`closed (code ${event.code}, reason ${logText(event.reason)})`);
    });
  }

  private teardown(): void {
    clearTimeout(this.helloTimer);
    clearInterval(this.heartbeatTimer);
    this.serving = false;
    for (const job of this.inFlight.values()) job.controller.abort();
    this.inFlight.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    let delay = this.nextDelayMs;
    this.nextDelayMs = undefined;
    if (delay === undefined) {
      delay = jitteredDelay(this.backoffMs, this.opts.random);
      this.backoffMs = Math.min(this.backoffMs * 2, this.opts.backoffMaxMs);
    }
    this.opts.log(`reconnecting in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string' || encoder.encode(data).length > MAX_FRAME_BYTES) {
      this.drop('not a text frame or over the frame cap');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.drop('not JSON');
      return;
    }
    const checked = validateThinkerFrame(json);
    if (!checked.ok) {
      this.drop(`invalid frame: ${logText(checked.errors[0] ?? 'unknown')}`);
      return;
    }
    const frame = checked.value;
    if (!this.serving) {
      if (frame.type === 'welcome') this.onWelcome(frame.accepted_models);
      else this.drop(`${frame.type} before welcome`);
      return;
    }
    switch (frame.type) {
      case 'job':
        void this.runJob(frame);
        return;
      case 'cancel':
        this.inFlight.get(frame.job_id)?.controller.abort();
        return;
      case 'drain':
        this.opts.log(`drain: reconnecting after ${frame.reconnect_after_seconds} s`);
        this.nextDelayMs = frame.reconnect_after_seconds * 1000;
        this.socket?.close(1000, 'drain');
        return;
      default:
        this.drop(`${frame.type} is not a colo frame`);
    }
  }

  private drop(why: string): void {
    this.droppedFrames += 1;
    this.opts.log(`dropped an inbound frame (${why}); total ${this.droppedFrames}`);
  }

  private onWelcome(acceptedModels: string[]): void {
    clearTimeout(this.helloTimer);
    this.serving = true;
    this.welcomes += 1;
    this.accepted = new Set(acceptedModels);
    this.backoffMs = this.opts.backoffInitialMs;
    this.opts.log(`welcomed; accepted ${acceptedModels.length} model(s)`);
    this.heartbeatTimer = setInterval(() => this.sendLoad(), this.opts.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private sendLoad(): void {
    const load: Record<string, number> = {};
    for (const model of this.advertised) load[model.name] = 0;
    for (const job of this.inFlight.values()) load[job.model] = (load[job.model] ?? 0) + 1;
    this.send({ type: 'heartbeat', load });
  }

  private async runJob(frame: JobFrameLike): Promise<void> {
    const id = frame.job_id;
    const pin = this.byName.get(frame.model);
    if (pin === undefined || !this.accepted.has(frame.model)) {
      this.fail(id, 'model_unavailable', 'model not served here');
      return;
    }
    // The Mind may ask only up to what the offer advertised; a larger ask is refused, not clamped.
    if (frame.max_tokens > ADVERTISED_MAX_TOKENS) {
      this.fail(
        id,
        'internal',
        `bad_request: max_tokens ${frame.max_tokens} is above the advertised ${ADVERTISED_MAX_TOKENS}`,
      );
      return;
    }
    if (this.inFlight.has(id)) {
      this.fail(id, 'internal', 'duplicate job id');
      return;
    }
    let running = 0;
    for (const job of this.inFlight.values()) if (job.model === frame.model) running += 1;
    if (running >= pin.maxConcurrent) {
      this.fail(id, 'internal', 'busy');
      return;
    }
    const remaining = Date.parse(frame.deadline) - Date.now();
    if (remaining <= 0) {
      this.fail(id, 'timeout', 'deadline already passed');
      return;
    }
    const entry: InFlight = {
      model: frame.model,
      controller: new AbortController(),
      timedOut: false,
    };
    this.inFlight.set(id, entry);
    // The timeout must reach the Mind before the deadline, or the Mind refuses it as late (BC-4).
    const timer = setTimeout(
      () => {
        entry.timedOut = true;
        entry.controller.abort();
      },
      Math.max(1, remaining - TIMEOUT_MARGIN_MS),
    );
    const started = Date.now();
    const socket = this.socket;
    try {
      const request = {
        pin,
        messages: frame.messages,
        maxTokens: frame.max_tokens,
        temperature: frame.temperature,
        stop: frame.stop,
        think: frame.reasoning === 'on',
        ...(frame.response_format ? { schema: frame.response_format.schema } : {}),
      };
      const result = await this.opts.chat(request, entry.controller.signal);
      if (entry.controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      this.opts.log(
        `job ${id} done in ${Date.now() - started} ms: ${result.promptTokens} in, ${result.completionTokens} out, ${result.text.length} chars`,
      );
      // 32 KiB of UTF-8 bytes (Appendix H); the contract caps characters, which is looser.
      if (encoder.encode(result.text).length > MAX_COMPLETION_TEXT) {
        this.fail(id, 'internal', 'output too large', socket);
      } else {
        this.send(
          {
            type: 'completion',
            job_id: id,
            text: result.text,
            usage_reported: {
              prompt_tokens: result.promptTokens,
              completion_tokens: result.completionTokens,
            },
          },
          socket,
        );
      }
    } catch (err) {
      if (entry.timedOut) {
        this.fail(id, 'timeout', 'deadline reached', socket);
      } else if (entry.controller.signal.aborted) {
        this.opts.log(`job ${id} aborted after ${Date.now() - started} ms`);
      } else if (err instanceof OllamaError) {
        this.fail(id, err.code, err.message, socket);
      } else {
        this.fail(id, 'internal', 'unexpected failure', socket);
      }
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(id);
    }
  }

  private fail(
    id: string,
    code: OllamaErrorCode,
    message: string,
    socket: WebSocket | null = this.socket,
  ): void {
    this.opts.log(`job ${id} failed: ${code} (${message})`);
    this.send({ type: 'error', job_id: id, code, message: message.slice(0, 200) }, socket);
  }

  /** Validates an outbound frame and sends it on the connection that asked; an invalid one is not sent. */
  private send(frame: unknown, socket: WebSocket | null = this.socket): void {
    if (socket === null || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    const checked = validateThinkerFrame(frame);
    if (!checked.ok) {
      this.opts.log(
        `refused to send an invalid outbound frame: ${logText(checked.errors[0] ?? 'unknown')}`,
      );
      return;
    }
    socket.send(JSON.stringify(frame));
  }
}

type ThinkerFrameValue = Extract<ReturnType<typeof validateThinkerFrame>, { ok: true }>['value'];
type JobFrameLike = Extract<ThinkerFrameValue, { type: 'job' }>;
