import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** The literal digest `shards/phase0.yaml` holds until the orchestrator records the real ones. */
export const PLACEHOLDER_DIGEST = 'sha256:RECORD_AT_DISPATCH';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** One pinned model: what the Thinker will advertise if Ollama has exactly this build. */
export interface ModelPin {
  /** The Ollama tag, such as `qwen3:32b`; also the name advertised to the Mind. */
  name: string;
  digest: string;
  numCtx: number;
  keepAlive: string;
  maxConcurrent: number;
}

export interface LanternConfig {
  /** The Mind's Thinker socket. */
  wsUrl: string;
  ollamaUrl: string;
  heartbeatMs: number;
  /** How long one pinned model may take to load in its warm-up before it is left unadvertised. */
  warmTimeoutMs: number;
  pins: ModelPin[];
}

export interface LoadOptions {
  /** The shard file; defaults to `shards/phase0.yaml` in the repository. */
  file?: string;
  env?: Record<string, string | undefined>;
  /** Tests only: accept the placeholder digest. The real loader refuses it. */
  allowPlaceholders?: boolean;
}

/** Thrown for any missing or invalid configuration; the process exits on it. */
export class ConfigError extends Error {}

/** The Thinker's own version, from `package.json`. */
export function thinkerVersion(): string {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return (pkg as { version: string }).version;
}

function defaultShardFile(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shards', 'phase0.yaml');
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${path} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function int(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ConfigError(`${path} must be an integer of at least ${min}`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`${path} must be a non-empty string`);
  }
  return value;
}

/** Throws unless the URL has the scheme and a loopback host (decision 0050, threat model section 3). */
export function requireLoopback(url: string, schemes: string[], what: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(`${what} is not a URL`);
  }
  if (!schemes.includes(parsed.protocol)) {
    throw new ConfigError(`${what} must use ${schemes.join(' or ')}`);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new ConfigError(`${what} must point at loopback`);
  }
  return url;
}

function parsePins(block: unknown, allowPlaceholders: boolean): ModelPin[] {
  const pins = obj(block, 'model_pins');
  const out: ModelPin[] = [];
  for (const [name, raw] of Object.entries(pins)) {
    const pin = obj(raw, `model_pins.${name}`);
    const digest = str(pin.digest, `model_pins.${name}.digest`);
    const placeholder = digest === PLACEHOLDER_DIGEST;
    if (placeholder ? !allowPlaceholders : !DIGEST.test(digest)) {
      throw new ConfigError(
        placeholder
          ? `model_pins.${name}.digest is still the placeholder; record the digest from ollama list`
          : `model_pins.${name}.digest must be sha256: and 64 hex digits`,
      );
    }
    out.push({
      name,
      digest,
      numCtx: int(pin.num_ctx, `model_pins.${name}.num_ctx`, 1),
      keepAlive: str(pin.keep_alive, `model_pins.${name}.keep_alive`),
      maxConcurrent: int(pin.max_concurrent, `model_pins.${name}.max_concurrent`, 1),
    });
  }
  if (out.length === 0) throw new ConfigError('model_pins must pin at least one model');
  return out;
}

/** Reads `model_pins` and `mind.thinker` from the shard file; the environment overrides the URLs. */
export function loadConfig(options: LoadOptions = {}): LanternConfig {
  const env = options.env ?? process.env;
  const doc = obj(parse(readFileSync(options.file ?? defaultShardFile(), 'utf8')), 'shard file');
  const thinker = obj(obj(doc.mind, 'mind').thinker, 'mind.thinker');
  const host = str(thinker.host, 'mind.thinker.host');
  const port = int(thinker.port, 'mind.thinker.port', 1);
  const heartbeatS = int(thinker.heartbeat_s, 'mind.thinker.heartbeat_s', 1);
  const warmS = int(thinker.warm_timeout_s, 'mind.thinker.warm_timeout_s', 1);
  const wsUrl = env.GELDAR_MIND_WS_URL ?? `ws://${host}:${port}/v1/thinker/stream`;
  const ollamaUrl = env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
  return {
    wsUrl: requireLoopback(wsUrl, ['ws:'], 'GELDAR_MIND_WS_URL'),
    ollamaUrl: requireLoopback(ollamaUrl, ['http:'], 'OLLAMA_URL'),
    heartbeatMs: heartbeatS * 1000,
    warmTimeoutMs: warmS * 1000,
    pins: parsePins(doc.model_pins, options.allowPlaceholders === true),
  };
}
