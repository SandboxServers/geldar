/**
 * PT-18a: a source scan of the Ledger plugin for APIs that would let it act on the world or reach an agent (S1, S5, S11),
 * and a `plugin.yml` check (S9). The lists live in `plugin-ledger-forbidden-api.json`; this file holds no names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import lists from './plugin-ledger-forbidden-api.json' with { type: 'json' };

export interface AllowEntry {
  /** Repo-relative path with forward slashes. */
  file: string;
  name: string;
  /** The allowance applies only to a line that contains this text. */
  text: string;
  reason: string;
}

export interface ScanLists {
  scanRoots: string[];
  forbiddenNames: string[];
  allow: AllowEntry[];
  pluginYml: {
    path: string;
    allowedKeys: string[];
    forbiddenKeys: string[];
    forbiddenNameWords: string[];
  };
}

export const LISTS: ScanLists = lists as ScanLists;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The regex of one list entry: a trailing `(` means a call, otherwise a whole word. */
export function patternFor(name: string): RegExp {
  if (name.endsWith('(')) return new RegExp(`\\b${escapeRegex(name.slice(0, -1))}\\s*\\(`);
  return new RegExp(`\\b${escapeRegex(name)}\\b`);
}

/** One finding per line and forbidden name. `file` is only used to match the allow-list and to label. */
export function scanJava(file: string, text: string, scan: ScanLists = LISTS): string[] {
  const hits: string[] = [];
  const allows = scan.allow.filter((entry) => entry.file === file);
  const patterns = scan.forbiddenNames.map((name) => [name, patternFor(name)] as const);
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [name, pattern] of patterns) {
      if (!pattern.test(line)) continue;
      if (allows.some((a) => a.name === name && line.includes(a.text))) continue;
      hits.push(`${file}:${index + 1}: forbidden API ${name}`);
    }
  });
  return hits;
}

/** Problems with a `plugin.yml` text: a key off the allow-list, a forbidden key, or a name with a telemetry word. */
export function scanPluginYml(text: string, scan: ScanLists = LISTS): string[] {
  const problems: string[] = [];
  const rules = scan.pluginYml;
  const keys = [...text.matchAll(/^([A-Za-z][\w-]*)\s*:(.*)$/gm)];
  for (const match of keys) {
    const key = match[1] ?? '';
    const lower = key.toLowerCase();
    if (rules.forbiddenKeys.includes(lower)) problems.push(`plugin.yml declares ${key}:`);
    else if (!rules.allowedKeys.includes(key))
      problems.push(`plugin.yml key ${key}: is not allowed`);
    if (key === 'name') {
      const name = (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
      for (const word of rules.forbiddenNameWords) {
        if (new RegExp(`${escapeRegex(word)}`, 'i').test(name)) {
          problems.push(`plugin.yml name ${name} contains ${word}`);
        }
      }
    }
  }
  return problems;
}

function javaFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return javaFiles(path);
    return path.endsWith('.java') ? [path] : [];
  });
}

/** Every finding under `root`: the Java sources of the scan roots (a missing root is skipped) and the `plugin.yml`. */
export function scanTree(root: string, scan: ScanLists = LISTS): string[] {
  const findings: string[] = [];
  for (const scanRoot of scan.scanRoots) {
    for (const path of javaFiles(join(root, scanRoot))) {
      const label = relative(root, path).replaceAll('\\', '/');
      findings.push(...scanJava(label, readFileSync(path, 'utf8'), scan));
    }
  }
  let yml: string;
  try {
    yml = readFileSync(join(root, scan.pluginYml.path), 'utf8');
  } catch {
    return [...findings, `${scan.pluginYml.path} cannot be read`];
  }
  return [...findings, ...scanPluginYml(yml, scan)];
}
