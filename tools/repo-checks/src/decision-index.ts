/**
 * Checks `docs/decisions/README.md` against the records next to it: every
 * `NNNN-*.md` record needs a row in the README table, and every table link must
 * point at a record that exists. A record missing from the table is invisible to
 * readers; a dead link is a record that was renamed or removed.
 */
const DECISIONS_DIR = 'docs/decisions/';
const README = `${DECISIONS_DIR}README.md`;
const RECORD = /^\d{4}-[^/]+\.md$/;
const TABLE_LINK = /\]\(([^)\s]+)\)/g;

/** Returns one message per record missing from the README table, and per dead table link. */
export function checkDecisionIndex(files: { path: string; text: string }[]): string[] {
  const records = new Set(
    files
      .filter((file) => file.path.startsWith(DECISIONS_DIR))
      .map((file) => file.path.slice(DECISIONS_DIR.length))
      .filter((name) => RECORD.test(name)),
  );
  const readme = files.find((file) => file.path === README)?.text ?? '';
  const linked = new Set<string>();
  for (const line of readme.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const match of line.matchAll(TABLE_LINK)) {
      if (match[1] !== undefined) linked.add(match[1]);
    }
  }
  const problems: string[] = [];
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
