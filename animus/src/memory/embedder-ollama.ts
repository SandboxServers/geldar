import type { Embedder } from '../ports/index.ts';
import { EMBEDDING_DIMS } from './vector.ts';

/** The task prefixes `nomic-embed-text` expects. */
const PREFIX = { document: 'search_document: ', query: 'search_query: ' } as const;

/** Options of `OllamaEmbedder`. */
export interface OllamaEmbedderOptions {
  /** `http://` URL of Ollama on loopback. */
  baseUrl: string;
  /** The model tag, `nomic-embed-text` in Phase 0. */
  model: string;
  /** Run the embedder on the CPU (`options.num_gpu: 0`), so it does not displace the thought model (R1). */
  onCpu: boolean;
  dims?: number;
  /** Milliseconds before a call is abandoned; 10 000 by default. */
  timeoutMs?: number;
}

/** Embeds text through Ollama's `POST /api/embed`. A failure throws; the callers degrade. */
export class OllamaEmbedder implements Embedder {
  readonly dims: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly onCpu: boolean;
  private readonly timeoutMs: number;

  constructor(options: OllamaEmbedderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.onCpu = options.onCpu;
    this.dims = options.dims ?? EMBEDDING_DIMS;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts.map((text) => PREFIX[kind] + text),
    };
    if (this.onCpu) body.options = { num_gpu: 0 };
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama /api/embed answered ${response.status}`);
    const json = (await response.json()) as { embeddings?: unknown };
    const vectors = json.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(
        `Ollama returned ${Array.isArray(vectors) ? vectors.length : 'no'} vectors for ${texts.length} texts`,
      );
    }
    for (const vector of vectors) {
      if (
        !Array.isArray(vector) ||
        vector.length !== this.dims ||
        vector.some((v) => typeof v !== 'number' || !Number.isFinite(v))
      ) {
        throw new Error(`Ollama returned a vector that is not ${this.dims} numbers`);
      }
    }
    return vectors as number[][];
  }
}
