import type { CharacterSheet, SheetResult } from './types.ts';

const TOP_KEYS = ['version', 'attributes', 'alignment', 'op_modes'];
const ATTRIBUTE_KEYS = ['curiosity', 'common_sense', 'cleverness', 'aggression'];
const ALIGNMENT_KEYS = ['law', 'good'];
const OP_MODE_KEYS = ['explorer', 'farmer', 'miner', 'builder', 'crafter', 'warrior', 'nitwit'];

type Plain = Record<string, unknown>;

function isObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freezeAll<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) freezeAll(child);
  }
  return Object.freeze(value);
}

/** The all-3 sheet: every score 3, deeply frozen. Used when a life has no configured sheet. */
export const STANDARD_SHEET: CharacterSheet = freezeAll({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

/** One score group. Unknown keys, missing keys and non-integer or out-of-range scores are errors. */
function scoreGroup(
  path: string,
  value: unknown,
  keys: string[],
  errors: string[],
): Plain | undefined {
  if (!isObject(value)) {
    errors.push(`${path}: must be an object`);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${path}.${key}: unknown key`);
  }
  const out: Plain = {};
  for (const key of keys) {
    const score = value[key];
    if (typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 5) {
      out[key] = score;
    } else {
      errors.push(`${path}.${key}: must be an integer from 1 to 5`);
    }
  }
  return out;
}

/** Strict validation. Returns a fresh copy on success; never repairs, never reads a field it does not name. */
export function normalizeSheet(input: unknown): SheetResult {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['sheet: must be an object'] };
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.includes(key)) errors.push(`${key}: unknown key`);
  }
  if (input.version !== 1) errors.push('version: must be 1');
  const attributes = scoreGroup('attributes', input.attributes, ATTRIBUTE_KEYS, errors);
  const alignment = scoreGroup('alignment', input.alignment, ALIGNMENT_KEYS, errors);
  const opModes = scoreGroup('op_modes', input.op_modes, OP_MODE_KEYS, errors);
  if (errors.length > 0 || !attributes || !alignment || !opModes) return { ok: false, errors };
  return {
    ok: true,
    sheet: {
      version: 1,
      attributes: attributes as CharacterSheet['attributes'],
      alignment: alignment as CharacterSheet['alignment'],
      op_modes: opModes as CharacterSheet['op_modes'],
    },
  };
}

/** A missing sheet (undefined or null) is the standard sheet. A malformed one throws and names the field. */
export function sheetOrStandard(input: unknown): { sheet: CharacterSheet; standard: boolean } {
  if (input === undefined || input === null) return { sheet: STANDARD_SHEET, standard: true };
  const result = normalizeSheet(input);
  if (!result.ok) throw new Error(`character sheet refused: ${result.errors.join('; ')}`);
  return { sheet: result.sheet, standard: false };
}

function canonicalValue(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const record = value as Plain;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`);
  return `{${parts.join(',')}}`;
}

/** The hashed form of a sheet: keys sorted at every level, no whitespace. Consumers hash this string. */
export function canonicalSheetJson(sheet: CharacterSheet): string {
  return canonicalValue(sheet);
}
