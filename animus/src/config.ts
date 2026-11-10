/**
 * The Mind's configuration (spec 5.3, 5.4, 5.8; decisions 0050, 0051). It reads the blocks of
 * `shards/<shard>.yaml` that the Mind owns (`mind`, `model_pins`, `embedding`, `attention`,
 * `memory`, `models`) and applies the environment overrides. A missing or invalid key fails fast
 * with the key's path in the message; every address must be loopback (decision 0050). The reflex
 * loader in golem reads `reflexes` alone; keys this loader does not know are ignored.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

/** The literal in `shards/*.yaml` that stands for a digest not yet recorded (decision 0051). */
export const DIGEST_PLACEHOLDER = 'sha256:RECORD_AT_DISPATCH';

/** The literal in `shards/*.yaml` that stands for a personality seed the owner has not approved. */
export const SEED_PLACEHOLDER = 'DRAFT_PENDING_OWNER_APPROVAL';

/** One pinned model (`model_pins.<tag>`). */
export interface ModelPin {
  /** `sha256:` and 64 hex digits, as `ollama list` reports; a model with another digest is not advertised. */
  digest: string;
  numCtx: number;
  /** Ollama duration, for example `30m`. */
  keepAlive: string;
  maxConcurrent: number;
}

/** The settings of one kind of job (`mind.thought`, `mind.reflection`). */
export interface JobSettings {
  maxTokens: number;
  temperature: number;
  /** Seconds after dispatch at which the job is worthless. */
  deadlineS: number;
  reasoning: 'off' | 'on';
}

/** Everything the Mind reads at startup. */
export interface AnimusConfig {
  shard: string;
  tickRate: number;
  /** The output validator's bounds, from the shard file (`validate/bounds.ts` has the defaults). */
  bounds: { worldBorderRadius: number; maxWorldTicks: number; maxBlockOperations: number };
  /** `nats://` URL on loopback. */
  natsUrl: string;
  /** `http://` URL of Ollama on loopback. */
  ollamaUrl: string;
  postgres: {
    host: string;
    port: number;
    user: string;
    database: string;
    /** The file holding the password; read it when connecting, never log it. */
    passwordFile: string;
  };
  agent: { name: string; username: string; tier: string; personalitySeed: string };
  thinker: { host: string; port: number; name: string; heartbeatS: number };
  /** How long the Mind waits for what it starts before the Body and the Thinker are up. */
  mind: {
    snapshotRetryS: number;
    thinkerWaitS: number;
    /** Estimated tokens of a thought's user message (`mind.prompt_budget_tokens`, see `promptCost`). */
    promptBudgetTokens: number;
    /** Beliefs loaded and shown, newest first (`mind.max_beliefs`). */
    maxBeliefs: number;
    /** Open commitments loaded and shown, earliest due first (`mind.max_commitments`). */
    maxCommitments: number;
    /** The thought template version, `thought/vN.md` (`mind.thought_version`; 1 to 4 exist). */
    thoughtVersion: number;
    /** How long a memory load may take before the Mind gives up (`mind.memory_timeout_s`). */
    memoryTimeoutS: number;
  };
  thought: JobSettings;
  reflection: JobSettings;
  admission: { maxThoughtsPerRealHour: number };
  plan: { expiresAfterTicks: number };
  /** The `models.*` tier this run uses. */
  runTier: string;
  /** Model tags per tier (`models`). */
  models: Record<string, string[]>;
  modelPins: Record<string, ModelPin>;
  embedding: { model: string; digest: string; dims: number; onCpu: boolean };
  attention: { minWakeupSpacingS: number; fallbackWakeupTicks: number; overheardToDigest: boolean };
  memory: {
    workingWindow: number;
    episodicTopK: number;
    fatigueDays: number;
    fatigueRule: boolean;
  };
}

/** Options of the loaders. */
export interface LoadOptions {
  /** Environment overrides; the process environment when absent. */
  env?: Record<string, string | undefined>;
  /** The shard file; `shards/<GELDAR_SHARD or phase0>.yaml` when absent. */
  file?: string;
  /** Accept the digest and personality-seed placeholders. Tests set it; a real run must not. */
  allowPlaceholders?: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const SHARD_NAME = /^[a-z][a-z0-9-]{1,31}$/;
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** The repository root: the nearest directory above this file that holds pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repository root not found: no pnpm-workspace.yaml above animus/src');
    }
    dir = parent;
  }
  return dir;
}

/** Reads the shard file and builds the configuration. Throws on the first problem. */
export async function loadAnimusConfig(options: LoadOptions = {}): Promise<AnimusConfig> {
  const env = options.env ?? process.env;
  const file = options.file ?? join(repoRoot(), 'shards', `${shardName(env)}.yaml`);
  return parseAnimusConfig(parse(await readFile(file, 'utf8')), options);
}

/** Builds the configuration from an already parsed shard file. Throws on the first problem. */
export function parseAnimusConfig(doc: unknown, options: LoadOptions = {}): AnimusConfig {
  const env = options.env ?? process.env;
  const allowPlaceholders = options.allowPlaceholders === true;
  const root = map(doc, 'shard file');
  const shard = shardName(env);
  const fileShard = text(root, 'shard');
  if (fileShard !== shard) {
    throw new Error(`shard file is for '${fileShard}' but GELDAR_SHARD selects '${shard}'`);
  }
  const mind = map(root.mind, 'mind');
  const agent = map(mind.agent, 'mind.agent');
  const thinker = map(mind.thinker, 'mind.thinker');
  const models = map(root.models, 'models');
  const tiers: Record<string, string[]> = {};
  for (const [tier] of Object.entries(models)) tiers[tier] = list(models, tier, 'models');
  const runTier = text(mind, 'run_tier', 'mind');
  const agentTier = text(agent, 'tier', 'mind.agent');
  for (const tier of [runTier, agentTier]) {
    if (tiers[tier] === undefined) throw new Error(`tier '${tier}' is not under models`);
  }
  const username = text(agent, 'username', 'mind.agent');
  if (!LIFE_ID.test(username))
    throw new Error(`mind.agent.username '${username}' is not a life id`);
  const seed = text(agent, 'personality_seed', 'mind.agent');
  if (seed === SEED_PLACEHOLDER && !allowPlaceholders) {
    throw new Error(
      'mind.agent.personality_seed is the placeholder: the owner must approve a seed',
    );
  }
  const pins = map(root.model_pins, 'model_pins');
  const modelPins: Record<string, ModelPin> = {};
  for (const tag of Object.keys(pins)) {
    const pin = map(pins[tag], `model_pins.${tag}`);
    modelPins[tag] = {
      digest: digest(pin, `model_pins.${tag}`, allowPlaceholders),
      numCtx: int(pin, 'num_ctx', `model_pins.${tag}`, 256),
      keepAlive: text(pin, 'keep_alive', `model_pins.${tag}`),
      maxConcurrent: int(pin, 'max_concurrent', `model_pins.${tag}`, 1),
    };
  }
  for (const tag of tiers[runTier] ?? []) {
    if (modelPins[tag] === undefined) throw new Error(`model_pins has no entry for '${tag}'`);
  }
  const embedding = map(root.embedding, 'embedding');
  const attention = map(root.attention, 'attention');
  const memory = map(root.memory, 'memory');
  const heartbeat = int(thinker, 'heartbeat_s', 'mind.thinker', 1);
  const thought = jobSettings(mind, 'thought');
  return {
    shard,
    tickRate: int(root, 'tick_rate', 'shard file', 1),
    bounds: {
      worldBorderRadius: int(root, 'world_border_radius', 'shard file', 1),
      maxWorldTicks: int(root, 'max_world_ticks', 'shard file', 1),
      maxBlockOperations: int(root, 'max_block_operations', 'shard file', 1),
    },
    natsUrl: loopbackUrl('GELDAR_NATS_URL', env.GELDAR_NATS_URL, 'nats:', 'nats://127.0.0.1:4222'),
    ollamaUrl: loopbackUrl('OLLAMA_URL', env.OLLAMA_URL, 'http:', 'http://127.0.0.1:11434'),
    postgres: {
      host: loopbackHost('POSTGRES_HOST', env.POSTGRES_HOST ?? '127.0.0.1'),
      port: envPort('POSTGRES_PORT', env.POSTGRES_PORT, 5432),
      user: env.POSTGRES_USER ?? 'geldar',
      database: env.POSTGRES_DB ?? 'geldar',
      passwordFile:
        env.POSTGRES_PASSWORD_FILE ?? join(repoRoot(), 'compose', 'secrets', 'postgres.txt'),
    },
    agent: {
      name: text(agent, 'name', 'mind.agent'),
      username,
      tier: agentTier,
      personalitySeed: seed,
    },
    thinker: {
      host: loopbackHost('mind.thinker.host', text(thinker, 'host', 'mind.thinker')),
      port: int(thinker, 'port', 'mind.thinker', 1, 65535),
      name: text(thinker, 'name', 'mind.thinker'),
      heartbeatS: heartbeat,
    },
    mind: {
      snapshotRetryS: optionalInt(mind, 'snapshot_retry_s', 'mind', 60, 0),
      thinkerWaitS: optionalInt(mind, 'thinker_wait_s', 'mind', 20, 0),
      // 2500: fits num_ctx 8192 with the system message and a 2048 output cap (library.ts, CONTEXT_TOKENS).
      promptBudgetTokens: optionalInt(mind, 'prompt_budget_tokens', 'mind', 2500, 1000),
      maxBeliefs: optionalInt(mind, 'max_beliefs', 'mind', 40, 1),
      maxCommitments: optionalInt(mind, 'max_commitments', 'mind', 10, 1),
      // 4: the default thought template (prompts/thought/v4.md, library.ts DEFAULT_THOUGHT_VERSION).
      thoughtVersion: optionalInt(mind, 'thought_version', 'mind', 4, 1),
      memoryTimeoutS: optionalInt(mind, 'memory_timeout_s', 'mind', 10, 1),
    },
    thought,
    reflection: jobSettings(mind, 'reflection', thought.temperature),
    admission: {
      maxThoughtsPerRealHour: int(
        map(mind.admission, 'mind.admission'),
        'max_thoughts_per_real_hour',
        'mind.admission',
        1,
      ),
    },
    plan: {
      expiresAfterTicks: int(map(mind.plan, 'mind.plan'), 'expires_after_ticks', 'mind.plan', 1),
    },
    runTier,
    models: tiers,
    modelPins,
    embedding: {
      model: text(embedding, 'model', 'embedding'),
      digest: digest(embedding, 'embedding', allowPlaceholders),
      dims: int(embedding, 'dims', 'embedding', 1),
      onCpu: bool(embedding, 'on_cpu', 'embedding'),
    },
    attention: {
      minWakeupSpacingS: int(attention, 'min_wakeup_spacing_s', 'attention', 0),
      fallbackWakeupTicks: int(attention, 'fallback_wakeup_ticks', 'attention', 1),
      overheardToDigest: bool(attention, 'overheard_to_digest', 'attention'),
    },
    memory: {
      workingWindow: int(memory, 'working_window', 'memory', 1),
      episodicTopK: int(memory, 'episodic_top_k', 'memory', 1),
      fatigueDays: int(memory, 'fatigue_days', 'memory', 1),
      // The fatigue switch (spec 5.4): on unless the shard file turns it off.
      fatigueRule:
        memory.fatigue_rule === undefined ? true : bool(memory, 'fatigue_rule', 'memory'),
    },
  };
}

/** Reads the Postgres password from its file, without the trailing newline. */
export async function readPostgresPassword(config: AnimusConfig): Promise<string> {
  const password = (await readFile(config.postgres.passwordFile, 'utf8')).trim();
  if (password === '')
    throw new Error(`Postgres password file ${config.postgres.passwordFile} is empty`);
  return password;
}

function shardName(env: Record<string, string | undefined>): string {
  const shard = env.GELDAR_SHARD ?? 'phase0';
  if (!SHARD_NAME.test(shard)) throw new Error(`GELDAR_SHARD '${shard}' is not a shard name`);
  return shard;
}

function jobSettings(
  mind: Record<string, unknown>,
  key: string,
  fallbackTemperature?: number,
): JobSettings {
  const block = map(mind[key], `mind.${key}`);
  const where = `mind.${key}`;
  const reasoning = text(block, 'reasoning', where);
  if (reasoning !== 'off' && reasoning !== 'on') {
    throw new Error(`${where}.reasoning must be "off" or "on", got '${reasoning}'`);
  }
  // The reflection block has no temperature in the shard file; it takes the thought's.
  const temperature = block.temperature ?? fallbackTemperature;
  if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
    throw new Error(`${where}.temperature must be a number from 0 to 2`);
  }
  return {
    maxTokens: int(block, 'max_tokens', where, 1),
    temperature,
    deadlineS: int(block, 'deadline_s', where, 1),
    reasoning,
  };
}

function digest(block: Record<string, unknown>, where: string, allowPlaceholders: boolean): string {
  const value = text(block, 'digest', where);
  if (value === DIGEST_PLACEHOLDER) {
    if (!allowPlaceholders) {
      throw new Error(`${where}.digest is the placeholder: record the digest from 'ollama list'`);
    }
  } else if (!DIGEST.test(value)) {
    throw new Error(`${where}.digest must be sha256: and 64 hex digits, got '${value}'`);
  }
  return value;
}

function map(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is missing or is not a map`);
  }
  return value as Record<string, unknown>;
}

function text(block: Record<string, unknown>, key: string, where?: string): string {
  const value = block[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where === undefined ? key : `${where}.${key}`} is missing or is not a text`);
  }
  return value;
}

function list(block: Record<string, unknown>, key: string, where: string): string[] {
  const value = block[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${where}.${key} must be a non-empty list of texts`);
  }
  return value as string[];
}

function bool(block: Record<string, unknown>, key: string, where: string): boolean {
  const value = block[key];
  if (typeof value !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
  return value;
}

function int(
  block: Record<string, unknown>,
  key: string,
  where: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = block[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${where}.${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** An integer setting that may be absent, in which case `fallback` applies. */
function optionalInt(
  block: Record<string, unknown>,
  key: string,
  where: string,
  fallback: number,
  min: number,
): number {
  return block[key] === undefined ? fallback : int(block, key, where, min);
}

function loopbackHost(name: string, host: string): string {
  if (!LOOPBACK_HOSTS.has(host))
    throw new Error(`${name} must be 127.0.0.1 or localhost, got '${host}'`);
  return host;
}

function loopbackUrl(
  name: string,
  raw: string | undefined,
  protocol: string,
  fallback: string,
): string {
  const value = raw === undefined || raw.trim() === '' ? fallback : raw;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a ${protocol}// URL, got '${value}'`);
  }
  if (url.protocol !== protocol)
    throw new Error(`${name} must be a ${protocol}// URL, got '${value}'`);
  loopbackHost(name, url.hostname);
  return value;
}

function envPort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port from 1 to 65535, got '${raw}'`);
  }
  return port;
}
