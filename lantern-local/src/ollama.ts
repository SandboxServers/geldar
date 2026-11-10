import type { ModelPin } from './config.ts';

export type OllamaErrorCode = 'model_unavailable' | 'timeout' | 'internal';

/** A failed Ollama call, already mapped onto an Appendix H error code. Messages carry no prompt text. */
export class OllamaError extends Error {
  readonly code: OllamaErrorCode;
  constructor(code: OllamaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** What the Thinker needs from one job to call Ollama. */
export interface ChatRequest {
  pin: ModelPin;
  messages: { role: string; content: string }[];
  maxTokens: number;
  temperature: number;
  stop: string[] | null;
  /** The JSON schema from the job's `response_format`, passed as Ollama's `format`. */
  schema?: object;
  /** The job's `reasoning` switch; absent means off. */
  think: boolean;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/** Runs one chat call; the Thinker takes it as a dependency so tests can swap it. */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>;

/** Loads one pinned model into memory before it is advertised; resolves once Ollama has answered. */
export type WarmFn = (pin: ModelPin, signal: AbortSignal) => Promise<void>;

interface ChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** The request body for `POST /api/chat` (spec 5.6: constrained output and pinned configuration). */
export function buildChatBody(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {
    num_ctx: request.pin.numCtx,
    temperature: request.temperature,
    num_predict: request.maxTokens,
  };
  if (request.stop !== null) options.stop = request.stop;
  const body: Record<string, unknown> = {
    model: request.pin.name,
    messages: request.messages,
    stream: false,
    think: request.think,
    options,
    keep_alive: request.pin.keepAlive,
  };
  if (request.schema !== undefined) body.format = request.schema;
  return body;
}

/**
 * Makes a {@link WarmFn} for the Ollama at `baseUrl`: a one-token chat call that carries the pin's own
 * `num_ctx` and `keep_alive`, so the model is resident with the configuration it will be served with.
 */
export function ollamaWarm(baseUrl: string): WarmFn {
  const chat = ollamaRequest(baseUrl);
  return async (pin, signal) => {
    await chat(
      {
        pin,
        messages: [{ role: 'user', content: 'Reply with one word.' }],
        maxTokens: 1,
        temperature: 0,
        stop: null,
        think: false,
      },
      signal,
    );
  };
}

/**
 * Makes the keep-alive call for the embedder: one `POST /api/embed` with `keep_alive` 30 m (decision 0051)
 * and, when the shard says `on_cpu`, `num_gpu` 0, the same options the animus embedder loads it with.
 */
export function ollamaEmbedPing(
  baseUrl: string,
  model: string,
  onCpu: boolean,
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const body: Record<string, unknown> = {
      model,
      input: 'Reply with one word.',
      keep_alive: '30m',
    };
    if (onCpu) body.options = { num_gpu: 0 };
    let res: Response;
    try {
      res = await fetch(new URL('/api/embed', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new OllamaError('model_unavailable', 'Ollama is not reachable');
    }
    if (res.status === 404) throw new OllamaError('model_unavailable', 'model not found in Ollama');
    if (!res.ok) throw new OllamaError('internal', `Ollama answered ${res.status}`);
    await res.json();
  };
}

/**
 * Makes a {@link ChatFn} that talks to the Ollama at `baseUrl`. With `think` on, the reasoning can spend
 * the whole output cap before any answer text (the cap counts thinking tokens), so an empty answer is
 * retried once with thinking off; an answer still empty is an error, not an empty completion.
 */
export function ollamaChat(baseUrl: string): ChatFn {
  const request1 = ollamaRequest(baseUrl);
  return async (request, signal) => {
    const first = await request1(request, signal);
    if (first.text.trim() !== '') return first;
    const second = await request1({ ...request, think: false }, signal);
    if (second.text.trim() !== '') return second;
    throw new OllamaError('internal', 'Ollama gave no answer text');
  };
}

/** One `POST /api/chat` call with no retry; the empty answer is returned as it came. */
function ollamaRequest(baseUrl: string): ChatFn {
  return async (request, signal) => {
    let res: Response;
    try {
      res = await fetch(new URL('/api/chat', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildChatBody(request)),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new OllamaError('model_unavailable', 'Ollama is not reachable');
    }
    if (res.status === 404) throw new OllamaError('model_unavailable', 'model not found in Ollama');
    if (!res.ok) throw new OllamaError('internal', `Ollama answered ${res.status}`);
    const data = (await res.json()) as ChatResponse;
    const promptTokens = data.prompt_eval_count ?? 0;
    // Ollama silently truncates a prompt that does not fit, then reports a full window (R5).
    if (promptTokens >= request.pin.numCtx) throw new OllamaError('internal', 'context overflow');
    return {
      text: data.message?.content ?? '',
      promptTokens,
      completionTokens: data.eval_count ?? 0,
    };
  };
}
