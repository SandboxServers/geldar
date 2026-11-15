/**
 * Checks the rows of the Decisions table in `docs/decisions/README.md`: the
 * record numbers must go up row by row, and no number may be listed twice. Two
 * sessions that each append a row at the end of the table conflict there; the
 * `merge=union` attribute keeps both rows, and this check catches a row that
 * landed out of place or twice. Only a row whose first cell links a `NNNN-*.md`
 * record is read: the header, the separator and rows that cite the spec are
 * skipped, as in `decision-index.ts`.
 */
const README = 'docs/decisions/README.md';
// The row's first cell may be bold; the record number is the first four digits of its link target.
const RECORD_ROW = /^\|\s*(?:\*\*)?\[[^\]]*\]\((\d{4})-[^)\s]*\)/;

/** Returns one message per row whose number repeats an earlier row or is lower than the row above the highest so far. */
export function checkDecisionRows(files: { path: string; text: string }[]): string[] {
  const readme = files.find((file) => file.path === README)?.text ?? '';
  const problems: string[] = [];
  const seen = new Set<number>();
  let highest = -1;
  for (const line of readme.split('\n')) {
    const digits = RECORD_ROW.exec(line.trimStart())?.[1];
    if (digits === undefined) continue;
    const number = Number(digits);
    if (seen.has(number)) {
      problems.push(`${README} lists ${digits} more than once`);
    } else if (number < highest) {
      const top = String(highest).padStart(4, '0');
      problems.push(`${README} row ${digits} comes after ${top} (keep the rows in number order)`);
    }
    seen.add(number);
    highest = Math.max(highest, number);
  }
  return problems;
}
