import {
  type CharacterSheet,
  DEFAULT_THRESHOLDS,
  normalizeSheet,
  STANDARD_SHEET,
} from '@geldar/psyche';

/** The `character` block of a shard file (AN-05a). Read by the loaders only; no schema edit. */
export interface CharacterConfig {
  mode: 'off' | 'sheet';
  /** d20 checks (D-CS-05); read only when mode is sheet. */
  rolls: boolean;
  proficiency: { enabled: boolean; thresholds: [number, number, number] };
}

/** One life's character: the block, and the sheet in force for that life (null when off). */
export interface LifeCharacter {
  config: CharacterConfig;
  sheet: CharacterSheet | null;
  /** `config`: the life's own sheet; `standard`: none stored, so STANDARD_SHEET; `off`: no sheet. */
  source: 'config' | 'standard' | 'off';
}

export type CharacterLog = (line: string) => void;

const consoleLog: CharacterLog = (line) => console.log(line);

/** The keys the instinct step owns: tolerated and ignored here, one log line each. */
const LATER_KEYS = [
  'idle_think_probability',
  'max_heuristic_picks',
  'failure_hard_cap',
  'sanity_check',
  'tom',
  'morality_hooks',
  'drift',
];
const KNOWN_KEYS = ['mode', 'rolls', 'proficiency'];
const PROFICIENCY_KEYS = ['enabled', 'thresholds'];

function offConfig(): CharacterConfig {
  return {
    mode: 'off',
    rolls: false,
    proficiency: {
      enabled: false,
      thresholds: [DEFAULT_THRESHOLDS[0], DEFAULT_THRESHOLDS[1], DEFAULT_THRESHOLDS[2]],
    },
  };
}

/** The config when the shard file has no character block: mode off. */
export const CHARACTER_OFF: CharacterConfig = offConfig();

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a map`);
  }
  return value as Record<string, unknown>;
}

function flag(from: Record<string, unknown>, key: string, where: string, fallback: boolean) {
  const value = from[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
  return value;
}

/** Three positive integers, strictly ascending; the bands of proficiency. */
function thresholds(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error('character.proficiency.thresholds must be three integers');
  }
  const whole = value.every(
    (item) => typeof item === 'number' && Number.isInteger(item) && item > 0,
  );
  if (!whole) throw new Error('character.proficiency.thresholds must be positive integers');
  const [low, middle, high] = value as [number, number, number];
  if (!(low < middle && middle < high)) {
    throw new Error('character.proficiency.thresholds must ascend');
  }
  return [low, middle, high];
}

/**
 * Builds the character block from a parsed shard file. An omitted or null block is off. The
 * instinct keys are tolerated and ignored (one log line each); any other unknown key throws.
 */
export function parseCharacterConfig(
  block: unknown,
  log: CharacterLog = consoleLog,
): CharacterConfig {
  if (block === undefined || block === null) return offConfig();
  const from = record(block, 'character');
  for (const key of Object.keys(from)) {
    if (LATER_KEYS.includes(key)) {
      log(`character.${key} is owned by the kit or a later wave; ignored`);
    } else if (!KNOWN_KEYS.includes(key)) {
      throw new Error(`character.${key}: unknown key`);
    }
  }
  const mode = from.mode ?? 'off';
  if (mode !== 'off' && mode !== 'sheet') throw new Error('character.mode must be off or sheet');
  const rolls = flag(from, 'rolls', 'character', false);
  const proficiency =
    from.proficiency === undefined ? {} : record(from.proficiency, 'character.proficiency');
  for (const key of Object.keys(proficiency)) {
    if (!PROFICIENCY_KEYS.includes(key))
      throw new Error(`character.proficiency.${key}: unknown key`);
  }
  const enabled = flag(proficiency, 'enabled', 'character.proficiency', false);
  const bands =
    proficiency.thresholds === undefined
      ? offConfig().proficiency.thresholds
      : thresholds(proficiency.thresholds);
  return { mode, rolls, proficiency: { enabled, thresholds: bands } };
}

/**
 * The sheet in force for one life. Mode off gives no sheet, even when one is stored. Sheet mode
 * with no stored sheet gives STANDARD_SHEET and logs one line. A malformed stored sheet throws,
 * naming the life and the field; it is never repaired. Log lines never carry score values.
 */
export function lifeCharacter(
  config: CharacterConfig,
  rawSheet: unknown,
  lifeId: string,
  log: CharacterLog = consoleLog,
): LifeCharacter {
  if (config.mode === 'off') return { config, sheet: null, source: 'off' };
  if (rawSheet === undefined || rawSheet === null) {
    log(`standard sheet for ${lifeId}`);
    return { config, sheet: STANDARD_SHEET, source: 'standard' };
  }
  const result = normalizeSheet(rawSheet);
  if (!result.ok) {
    throw new Error(`character sheet for ${lifeId} refused: ${result.errors.join('; ')}`);
  }
  return { config, sheet: result.sheet, source: 'config' };
}
