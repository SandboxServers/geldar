import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseReflexConfig, type ReflexConfig } from '../body/reflex-config.ts';
import type { RunStamp } from '../body/stamped-publisher.ts';
import {
  type CharacterLog,
  type LifeCharacter,
  lifeCharacter,
  parseCharacterConfig,
} from '../character/character-config.ts';
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
  /** `body_actions.use`: whether the Body accepts the `use` verb (off when left out; decision 0218). */
  use: boolean;
  /** `body_actions.swim`: whether the goto swims and climbs out of water (off when left out; decision 0194). */
  swim: boolean;
  /** `body_actions.building`: whether break, plan and the seen map are on (off when left out; BLD-38g). */
  building: boolean;
  /** `20 / tick_rate`: the executor's time scale. */
  timeScale: number;
  /** `mind.agent.harness` and `mind.agent.model`, stamped on the Body's events; absent when neither is set. */
  stamp?: RunStamp;
  /** `root.character` and this life's sheet (`mind.agent.character_sheet`); filled by the parser. */
  character?: LifeCharacter;
}

/** The contract's patterns for the envelope's `harness` and `model` (contract/schemas/event.schema.json). */
const HARNESS_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/;

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

/** The optional `harness` and `model` under `mind.agent`; none when both are left out. */
function runStamp(agent: Record<string, unknown>): RunStamp | undefined {
  const { harness, model } = agent;
  if (harness === undefined && model === undefined) return undefined;
  const stamp: RunStamp = {};
  if (harness !== undefined) {
    if (typeof harness !== 'string' || !HARNESS_PATTERN.test(harness)) {
      throw new Error('mind.agent.harness must be lower-case letters, digits and hyphens');
    }
    stamp.harness = harness;
  }
  if (model !== undefined) {
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
      throw new Error('mind.agent.model must be 1 to 128 model-name characters');
    }
    stamp.model = model;
  }
  return stamp;
}

/** Builds the config from a parsed shard file; throws on the first missing or invalid key. */
export function parseAdamConfig(doc: unknown, log?: CharacterLog): AdamConfig {
  const root = block(doc, 'shard file');
  const agent = block(block(root.mind, 'mind').agent, 'mind.agent');
  const chat = block(root.chat, 'chat');
  const stamp = runStamp(agent);
  const lifeId = text(agent, 'username', 'mind.agent');
  const character = lifeCharacter(
    parseCharacterConfig(root.character, log),
    agent.character_sheet,
    lifeId,
    log,
  );
  return {
    ...(stamp === undefined ? {} : { stamp }),
    shard: text(root, 'shard', 'shard file'),
    lifeId,
    character,
    displayName: text(agent, 'name', 'mind.agent'),
    rateLimitSeconds: positive(chat, 'rate_limit_seconds', 'chat'),
    maxChars: positive(chat, 'max_chars', 'chat'),
    reflexes: parseReflexConfig(root.reflexes),
    editSign: bodyActionFlag(root, 'edit_sign'),
    use: bodyActionFlag(root, 'use'),
    swim: bodyActionFlag(root, 'swim'),
    building: bodyActionFlag(root, 'building'),
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
