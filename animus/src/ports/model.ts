/**
 * The Mind's view of a language model (spec 5.3, Appendix H). The thinking loop and the sleep
 * reflection call `ModelClient.complete`; P0-25 implements it over the Thinker hub, the fakes
 * implement it from a script. Nothing here knows about frames, sockets or Ollama.
 */

/** One chat message, in the order the model reads them. */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** One model call. */
export interface ModelJob {
  /** The model tag, for example `qwen3:32b`. Fixed for a life (spec 5.3.3). */
  model: string;
  /** At least one message; the Thinker contract allows at most 64. */
  messages: ModelMessage[];
  /** Output cap in tokens. */
  maxTokens: number;
  /** Sampling temperature. */
  temperature: number;
  /**
   * The moment after which the call is worthless. The client rejects with `timeout` once it has
   * passed and tells the Thinker to stop (the job frame's `deadline` is this value as ISO 8601).
   */
  deadline: Date;
  /** A JSON Schema the output must satisfy (decision 0049). A Thinker without support ignores it. */
  responseSchema?: Record<string, unknown>;
  /** Whether the model may think before answering (decision 0049). Absent means the Thinker's default. */
  reasoning?: 'off' | 'on';
  /**
   * How many leading characters of the first messages are identical from call to call, so the
   * Thinker can reuse its cache (the job frame's `cache_hint.stable_prefix_chars`). Zero for none.
   */
  stablePrefixChars: number;
}

/** What a finished call returns. */
export interface ModelCompletion {
  /** The model's raw output. Untrusted: the output validator is the control. */
  text: string;
  /** Token counts the provider reported, when it did. Absent means "not reported", not zero. */
  usageReported?: { promptTokens: number; completionTokens: number };
  /** The name of the Thinker that ran the job (the welcome frame's `thinker`). */
  thinkerId: string;
  /** Wall time from submit to completion, in milliseconds. */
  latencyMs: number;
}

/** Why a call failed. */
export type ModelErrorCode =
  /** No Thinker is connected that accepts the model. */
  | 'no_thinker'
  /** The Thinker reported the model unavailable. */
  | 'model_unavailable'
  /** The deadline passed before a completion arrived. */
  | 'timeout'
  /** Any other failure (a Thinker `internal` error, a malformed frame, a closed socket). */
  | 'internal'
  /** The caller's signal aborted the call. */
  | 'cancelled';

/** The only error `ModelClient.complete` rejects with. */
export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelError';
    this.code = code;
  }
}

/** Runs model calls. One instance serves the whole Mind. */
export interface ModelClient {
  /**
   * Runs `job` and resolves with the completion. Rejects with a `ModelError` and nothing else. An
   * aborted `signal` rejects with code `cancelled`; the client tells the Thinker to stop the job.
   */
  complete(job: ModelJob, signal: AbortSignal): Promise<ModelCompletion>;
}
