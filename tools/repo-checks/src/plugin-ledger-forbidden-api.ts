/**
 * PT-18a: a source scan of the Ledger plugin for APIs that would let it act on the world or reach an agent (S1, S5, S11),
 * and a `plugin.yml` check (S9). The lists live in `plugin-ledger-forbidden-api.json`; this file holds no names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isAlias, isMap, isScalar, parseAllDocuments, visit } from 'yaml';
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

/**
 * Problems with a `plugin.yml` text, from a real YAML parse (the `yaml` package): a top-level key off the allow-list,
 * a forbidden key at any depth (quoted, indented or inside a flow mapping alike), or a name with a telemetry word.
 * Fails closed: anything it cannot judge (a parse error, tab indentation, several documents, a top level that is not
 * a mapping, a non-scalar key, an anchor, an alias or a merge key) is itself a problem.
 */
export function scanPluginYml(text: string, scan: ScanLists = LISTS): string[] {
  const rules = scan.pluginYml;
  const unreadable = (why: string): string[] => [`plugin.yml cannot be checked: ${why}`];
  if (/^[ ]*\t/m.test(text)) return unreadable('tab indentation');
  const docs = Array.from(parseAllDocuments(text));
  if (docs.length !== 1) return unreadable(`${docs.length} documents, expected 1`);
  const doc = docs[0];
  if (doc === undefined) return unreadable('no document');
  const firstError = doc.errors[0];
  if (firstError !== undefined)
    return unreadable(`parse error: ${firstError.message.split('\n')[0]}`);
  const root = doc.contents;
  if (!isMap(root)) return unreadable('the top level is not a mapping');

  const problems: string[] = [];
  let unsupported: string | undefined;
  visit(doc, {
    Node(_key, node) {
      if (isAlias(node)) unsupported = 'an alias (*name)';
      else if ('anchor' in node && node.anchor) unsupported = 'an anchor (&name)';
      return unsupported === undefined ? undefined : visit.BREAK;
    },
    Pair(_key, pair) {
      if (!isScalar(pair.key)) unsupported = 'a key that is not a plain scalar';
      else if (String(pair.key.value) === '<<') unsupported = 'a merge key (<<)';
      else if (rules.forbiddenKeys.includes(String(pair.key.value).toLowerCase())) {
        problems.push(`plugin.yml declares ${String(pair.key.value)}:`);
      }
      return unsupported === undefined ? undefined : visit.BREAK;
    },
  });
  if (unsupported !== undefined) return unreadable(`it uses ${unsupported}`);

  for (const pair of root.items) {
    const key = String((pair.key as { value: unknown }).value);
    if (!rules.forbiddenKeys.includes(key.toLowerCase()) && !rules.allowedKeys.includes(key)) {
      problems.push(`plugin.yml key ${key}: is not allowed`);
    }
    if (key !== 'name') continue;
    if (!isScalar(pair.value)) {
      problems.push('plugin.yml name is not a plain string');
      continue;
    }
    const name = String(pair.value.value ?? '');
    for (const word of rules.forbiddenNameWords) {
      if (new RegExp(`${escapeRegex(word)}`, 'i').test(name)) {
        problems.push(`plugin.yml name ${name} contains ${word}`);
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
