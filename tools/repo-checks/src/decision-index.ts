/**
 * Checks `docs/decisions/README.md` against the records next to it: every
 * `NNNN-*.md` record needs a row in the README table, and every row's link (its
 * first cell) must point at a record that exists. Any other Markdown file in the
 * folder must be a numbered record too, so a misnamed record cannot dodge the
 * check. A record missing from the table is invisible to readers; a dead link is
 * a record that was renamed or removed. Only the first cell is read as the row's
 * link: later cells may cite the spec, external sources or another record's status.
 */
const DECISIONS_DIR = 'docs/decisions/';
const README = `${DECISIONS_DIR}README.md`;
const RECORD = /^\d{4}-[^/]+\.md$/;
const ROW_LINK = /^\|\s*\[[^\]]*\]\(([^)\s]+)\)/;

/**
 * Returns one message per record missing from the README table, per dead row
 * link, and per Markdown file in the folder that is not a numbered record.
 */
export function checkDecisionIndex(files: { path: string; text: string }[]): string[] {
  const names = files
    .filter((file) => file.path.startsWith(DECISIONS_DIR))
    .map((file) => file.path.slice(DECISIONS_DIR.length));
  const records = new Set(names.filter((name) => RECORD.test(name)));
  const problems: string[] = [];
  for (const name of names) {
    if (name !== 'README.md' && name.endsWith('.md') && !RECORD.test(name)) {
      problems.push(`${DECISIONS_DIR}${name} is not named NNNN-slug.md (rename it or move it out)`);
    }
  }
  const readme = files.find((file) => file.path === README)?.text ?? '';
  const linked = new Set<string>();
  for (const line of readme.split('\n')) {
    const target = ROW_LINK.exec(line.trimStart())?.[1];
    // Spec and external links are not records; `#anchor` and `./` do not change the file.
    if (target === undefined || target.includes('://') || target.startsWith('..')) continue;
    const [path = ''] = target.split('#');
    const name = path.replace(/^\.\//, '');
    if (name !== '') linked.add(name);
  }
  for (const name of records) {
    if (!linked.has(name))
      problems.push(`${README} does not list ${name} (add its row to the table)`);
  }
  for (const target of linked) {
    if (!records.has(target)) {
      problems.push(`${README} links ${target}, which is not a record in ${DECISIONS_DIR}`);
    }
  }
  return problems;
}
