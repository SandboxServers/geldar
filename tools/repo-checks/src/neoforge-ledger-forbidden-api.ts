/**
 * PT-N10: a source scan of the NeoForge Ledger (`neoforge-ledger/`) for APIs that would let it act on the world, reach
 * an agent, read chat, sign, book, prompt or repo text, or touch secrets (S1, S5, S9, S11). The lists live in
 * `neoforge-ledger-forbidden-api.json`; the matching is the Paper scanner's (`scanJava`), so the two cannot drift.
 * The Paper list and the neutral `ledger-core` list are not touched here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import lists from './neoforge-ledger-forbidden-api.json' with { type: 'json' };
import { type AllowEntry, scanJava } from './plugin-ledger-forbidden-api.ts';

export interface NeoForgeScanLists {
  scanRoots: string[];
  forbiddenNames: string[];
  allow: AllowEntry[];
  modsToml: { path: string; forbiddenTables: string[]; forbiddenNameWords: string[] };
}

export const NEOFORGE_LISTS: NeoForgeScanLists = lists as NeoForgeScanLists;

/** Problems with a `neoforge.mods.toml` text: a forbidden table header, or a mod id or display name with a telemetry word. */
export function scanModsToml(text: string, scan: NeoForgeScanLists = NEOFORGE_LISTS): string[] {
  const problems: string[] = [];
  const rules = scan.modsToml;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const table = /^\[{1,2}\s*([^\]]+?)\s*\]{1,2}$/.exec(line)?.[1];
    if (table !== undefined && rules.forbiddenTables.includes(table)) {
      problems.push(`neoforge.mods.toml declares [${table}]`);
    }
    const name = /^(modId|displayName)\s*=\s*"([^"]*)"/.exec(line);
    if (name === null) continue;
    for (const word of rules.forbiddenNameWords) {
      if ((name[2] ?? '').toLowerCase().includes(word)) {
        problems.push(`neoforge.mods.toml ${name[1]} ${name[2]} contains ${word}`);
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

/** Every finding under `root`: the Java sources of the scan roots (a missing root is skipped) and the mods.toml. */
export function scanNeoForgeTree(root: string, scan: NeoForgeScanLists = NEOFORGE_LISTS): string[] {
  const findings: string[] = [];
  for (const scanRoot of scan.scanRoots) {
    for (const path of javaFiles(join(root, scanRoot))) {
      const label = relative(root, path).replaceAll('\\', '/');
      findings.push(
        ...scanJava(label, readFileSync(path, 'utf8'), { ...scan, pluginYml: undefined as never }),
      );
    }
  }
  let toml: string;
  try {
    toml = readFileSync(join(root, scan.modsToml.path), 'utf8');
  } catch {
    return [...findings, `${scan.modsToml.path} cannot be read`];
  }
  return [...findings, ...scanModsToml(toml, scan)];
}
