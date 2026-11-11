import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';

/** The reflexes of the spec 5.2 table, in table order. Each has one flag in `shards/*.yaml`. */
export const REFLEX_NAMES = [
  'eat',
  'retreat',
  'hazard_escape',
  'fall_stop',
  'fight_or_flee',
  'blocked_path',
  'panic_burrow',
  'unstick',
] as const;

/** One reflex's name, exactly as in the shard file and in `reflex_fired` records. */
export type ReflexName = (typeof REFLEX_NAMES)[number];

/**
 * The shard's reflex settings. `enabled: false` turns every reflex off; otherwise a reflex runs
 * unless its own flag is false. A flag the shard file leaves out is true.
 */
export interface ReflexConfig {
  enabled: boolean;
  flags: Record<ReflexName, boolean>;
}

/** A config with every reflex on. */
export function allReflexesOn(): ReflexConfig {
  return {
    enabled: true,
    flags: Object.fromEntries(REFLEX_NAMES.map((name) => [name, true])) as Record<
      ReflexName,
      boolean
    >,
  };
}

/** True when the reflex may run under this config. */
export function isReflexEnabled(config: ReflexConfig, name: ReflexName): boolean {
  return config.enabled && config.flags[name];
}

/**
 * Reads the `reflexes` block of a parsed shard file. Throws on a value that is not a boolean and
 * on a key that is neither `enabled` nor a reflex name, so a typo cannot silently leave a reflex on.
 */
export function parseReflexConfig(block: unknown): ReflexConfig {
  const config = allReflexesOn();
  if (block === undefined || block === null) return config;
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('shard reflexes must be a map of booleans');
  }
  for (const [key, value] of Object.entries(block)) {
    if (typeof value !== 'boolean') throw new Error(`shard reflexes.${key} must be true or false`);
    if (key === 'enabled') {
      config.enabled = value;
    } else if ((REFLEX_NAMES as readonly string[]).includes(key)) {
      config.flags[key as ReflexName] = value;
    } else {
      throw new Error(`shard reflexes.${key} is not a reflex (${REFLEX_NAMES.join(', ')})`);
    }
  }
  return config;
}

/** Reads the reflex settings from a shard file; the default is the Phase 0 shard file. */
export async function loadReflexConfig(
  file: string = join(repoRoot(), 'shards', 'phase0.yaml'),
): Promise<ReflexConfig> {
  const doc: unknown = parse(await readFile(file, 'utf8'));
  if (typeof doc !== 'object' || doc === null) throw new Error(`${file} is not a shard file`);
  return parseReflexConfig((doc as { reflexes?: unknown }).reflexes);
}
