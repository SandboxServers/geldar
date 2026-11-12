import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Expands `*` and `?` in the file name part of a path (the directory part is literal). No match: the path itself. */
export function expandGlob(pattern: string): string[] {
  if (!/[*?]/.test(basename(pattern))) return [pattern];
  const dir = dirname(pattern);
  const re = new RegExp(
    `^${basename(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
  const hits = readdirSync(dir)
    .filter((f) => re.test(f))
    .sort();
  return hits.length === 0 ? [pattern] : hits.map((f) => join(dir, f));
}

const ID_IN_NAME = /(ag)[-_]([a-z0-9]+)[-_](\d+)/i;

/** `players-host-ag-zack-01.log` and `ag_zack_01.log` both give `ag_zack_01`; no id in the name gives null. */
export function agentFromFilename(path: string): string | null {
  const m = ID_IN_NAME.exec(basename(path));
  return m ? `ag_${(m[2] as string).toLowerCase()}_${m[3]}` : null;
}

const LIFE_ID = /"life_id"\s*:\s*"([^"]+)"/g;

/**
 * The agent of every line of a file that names none: the single life_id found in the file, else the id in
 * the file name, else null. A file with several life ids (a merged log) gives null.
 */
export function agentOfFile(path: string, text: string): string | null {
  const ids = new Set([...text.matchAll(LIFE_ID)].map((m) => m[1] as string));
  if (ids.size === 1) return [...ids][0] as string;
  if (ids.size > 1) return null;
  return agentFromFilename(path);
}

/** Reads every file the patterns name; `parse` gets the text and the file's agent (`--agent` wins). */
export function readMany<T>(
  patterns: string[],
  forcedAgent: string | null,
  parse: (text: string, agent: string | null) => T[],
): T[] {
  return patterns.flatMap(expandGlob).flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return parse(text, forcedAgent ?? agentOfFile(f, text));
  });
}
