import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { repoRoot } from './config.ts';

/**
 * The environment of one service of compose/colo.yml, as compose resolves it: merge keys applied, and a
 * null value (`NAME:` with no value) left out, because compose leaves an unset variable unset.
 */
export function coloServiceEnv(service: string): Record<string, string> {
  const file = join(repoRoot(), 'compose', 'colo.yml');
  const doc = parse(readFileSync(file, 'utf8'), { merge: true }) as {
    services?: Record<string, { environment?: Record<string, string | null> }>;
  };
  const block = doc.services?.[service];
  if (block === undefined) throw new Error(`${file} has no service '${service}'`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(block.environment ?? {})) {
    if (value !== null) env[name] = String(value);
  }
  return env;
}
