/**
 * BLD-19 fence: the seen map never reaches a telemetry path. `eventsink/`, `telemetry/` and `glass/` must not
 * name the seen module (`golem/src/building/seen`), its KV bucket (`geldar-seen`, `SEEN_BUCKET`), so no
 * dashboard, sink or Glass page can show what the Body has seen. Every `.ts` file under those roots counts,
 * tests and comments included: the scan reads text, not code, so a mention is a finding.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Repo-relative, forward slashes. */
export const TELEMETRY_ROOTS = ['eventsink', 'telemetry', 'glass'];

const SEEN_REFERENCE = /building\/seen|geldar[-.]seen|SEEN_BUCKET/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);

/** Every `.ts` file under `dir`, recursively, as absolute paths. */
export function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** One `label:line: text` entry per line of `source` that names the seen module, bucket or subjects. */
export function scanSeenReferences(label: string, source: string): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    if (SEEN_REFERENCE.test(line)) hits.push(`${label}:${index + 1}: ${line.trim()}`);
  });
  return hits;
}

/** Scans every telemetry root under `root`; returns the hits and how many files were read per root. */
export function seenFenceReport(root: string = ROOT): {
  hits: string[];
  files: Record<string, number>;
} {
  const hits: string[] = [];
  const files: Record<string, number> = {};
  for (const top of TELEMETRY_ROOTS) {
    const paths = tsFilesUnder(join(root, top));
    files[top] = paths.length;
    for (const path of paths) {
      const label = relative(root, path).split('\\').join('/');
      hits.push(...scanSeenReferences(label, readFileSync(path, 'utf8')));
    }
  }
  return { hits, files };
}
