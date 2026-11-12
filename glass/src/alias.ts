/**
 * Private public-display aliases. A JSON file named by GELDAR_ALIASES_FILE maps an agent id to the
 * name humans see: {"<agent id>": "<alias>"}. The file lives on the node, never in the repo. Absent,
 * unreadable or invalid: no aliases, one log line, and everything shows the stored name as before.
 * Only display changes; the database and the Mind keep the real names. No name is ever logged.
 */
import { readFileSync } from 'node:fs';

export type AliasMap = ReadonlyMap<string, string>;

const NONE: AliasMap = new Map();
let current: AliasMap = NONE;

/** Reads the alias file. Never throws; an unusable file gives an empty map and one log line. */
export function loadAliases(
  path: string | undefined,
  log: (line: string) => void = console.warn,
): AliasMap {
  if (path === undefined || path === '') return NONE;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const map = new Map<string, string>();
    for (const [id, alias] of Object.entries(parsed)) {
      if (typeof alias === 'string' && alias.trim() !== '') map.set(id, alias);
    }
    return map;
  } catch {
    log('glass: alias file missing, unreadable or invalid; showing stored names');
    return NONE;
  }
}

/** Loads the aliases once at startup from GELDAR_ALIASES_FILE. */
export function initAliases(
  env: NodeJS.ProcessEnv = process.env,
  log?: (line: string) => void,
): void {
  current = loadAliases(env.GELDAR_ALIASES_FILE, log);
}

/** Replaces the active map (tests). */
export function setAliases(map: AliasMap): void {
  current = map;
}

/** The alias for an agent id, or the fallback (the stored name) when there is none. */
export function aliasOf<T>(id: unknown, fallback: T): string | T {
  return (typeof id === 'string' ? current.get(id) : undefined) ?? fallback;
}

/** A copy of a row with `name` replaced by the alias of the agent id in `idKey`, when one is mapped. */
export function withAlias<R extends Record<string, unknown>>(row: R, idKey: string): R {
  const alias = typeof row[idKey] === 'string' ? current.get(row[idKey] as string) : undefined;
  return alias === undefined || !('name' in row) ? row : { ...row, name: alias };
}
