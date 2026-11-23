/**
 * Decides whether a change touches only documentation, for the `changes` job in `.github/workflows/ci.yml`.
 * When it does, ci.yml skips the heavy jobs (Gradle, compose, sql, images, integration). The `typescript` job
 * still runs, because many of its tests read docs/ (the decision index, runbooks, legal pages, leak scans).
 *
 * A path counts as documentation when it is under `docs/`, or is a Markdown file outside `prompts/`. Prompt
 * templates are runtime input, not documentation, so a change to one runs the whole suite. An empty change list is
 * not "docs only": with nothing to compare, the suite runs in full.
 *
 * CLI: reads one path per line on stdin (the output of `git diff --no-renames --name-only`) and prints
 * `docs_only=true` or `docs_only=false` for `$GITHUB_OUTPUT`. Pass `--no-renames`: with rename detection, a code
 * file moved to `docs/` would be listed only under its new name.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when `path` (repo-relative, forward slashes) is documentation that no job other than `typescript` reads. */
export function isDocsPath(path: string): boolean {
  const p = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (p === '' || p.split('/').includes('..')) return false;
  if (p.startsWith('docs/')) return true;
  if (p.startsWith('prompts/')) return false;
  return /\.md$/i.test(p);
}

/** True when the change list is non-empty and every path in it is documentation. */
export function isDocsOnly(paths: readonly string[]): boolean {
  const listed = paths.map((p) => p.trim()).filter((p) => p !== '');
  return listed.length > 0 && listed.every(isDocsPath);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, 'utf8').split(/\r?\n/);
  const docsOnly = isDocsOnly(paths);
  const listed = paths.filter((p) => p.trim() !== '');
  const code = listed.filter((p) => !isDocsPath(p));
  process.stderr.write(
    `${listed.length} changed path(s); ${code.length} outside the docs set${code.length > 0 ? ` (first: ${code[0]})` : ''}\n`,
  );
  process.stdout.write(`docs_only=${docsOnly}\n`);
}
