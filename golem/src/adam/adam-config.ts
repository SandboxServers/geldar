import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseReflexConfig, type ReflexConfig } from '../body/reflex-config.ts';
import { repoRoot } from '../config.ts';

/** What Adam's Body reads from `shards/<shard>.yaml` (decisions 0050, 0051). */
export interface AdamConfig {
  shard: string;
  /** The game account username, equal to the life id (decision 0040). */
  lifeId: string;
  /** The name in prompts and in addressed-speech detection; both names count. */
  displayName: string;
  /** `chat.rate_limit_seconds`. */
  rateLimitSeconds: number;
  /** `chat.max_chars`. */
  maxChars: number;
  reflexes: ReflexConfig;
  /** `body_actions.edit_sign`: whether the Body accepts the `edit_sign` verb (off when left out). */
  editSign: boolean;
  /** `20 / tick_rate`: the executor's time scale. */
  timeScale: number;
}

function block(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is missing or is not a map`);
  }
  return value as Record<string, unknown>;
}

function text(from: Record<string, unknown>, key: string, where: string): string {
  const value = from[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}.${key} is missing or is not a text`);
  }
  return value;
}

function positive(from: Record<string, unknown>, key: string, where: string): number {
  const value = from[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where}.${key} must be a positive number`);
  }
  return value;
}

/** A `body_actions` flag from the shard file; a flag the file leaves out is off. */
function bodyActionFlag(root: Record<string, unknown>, name: string): boolean {
  const actions = root.body_actions === undefined ? {} : block(root.body_actions, 'body_actions');
  const value = actions[name];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error(`body_actions.${name} must be true or false`);
  return value;
}

/** Builds the config from a parsed shard file; throws on the first missing or invalid key. */
export function parseAdamConfig(doc: unknown): AdamConfig {
  const root = block(doc, 'shard file');
  const agent = block(block(root.mind, 'mind').agent, 'mind.agent');
  const chat = block(root.chat, 'chat');
  return {
    shard: text(root, 'shard', 'shard file'),
    lifeId: text(agent, 'username', 'mind.agent'),
    displayName: text(agent, 'name', 'mind.agent'),
    rateLimitSeconds: positive(chat, 'rate_limit_seconds', 'chat'),
    maxChars: positive(chat, 'max_chars', 'chat'),
    reflexes: parseReflexConfig(root.reflexes),
    editSign: bodyActionFlag(root, 'edit_sign'),
    timeScale: 20 / positive(root, 'tick_rate', 'shard file'),
  };
}

/** Reads the config of the shard `GELDAR_SHARD` names (default `phase0`). */
export async function loadAdamConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<AdamConfig> {
  const file = join(repoRoot(), 'shards', `${env.GELDAR_SHARD ?? 'phase0'}.yaml`);
  return parseAdamConfig(parse(await readFile(file, 'utf8')));
}
