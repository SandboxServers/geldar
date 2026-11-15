/**
 * Evidence report for the sheet driver step 0: the rows the real pipeline wrote for one scratch life,
 * printed as plain tables. Input is `psql --csv` output. Only unquoted scalar columns are supported:
 * the queries select no free text, so a quoted field is an error, not something to guess at.
 */
export interface CsvTable {
  header: string[];
  rows: string[][];
}

export interface ReportSection {
  title: string;
  csv: string;
}

/** Parses `psql --csv` text. Empty input (no header, no rows) is an empty table. */
export function parseCsv(csv: string): CsvTable {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.some((line) => line.includes('"'))) {
    throw new Error('quoted CSV fields are not supported by the evidence report');
  }
  const [header = [], ...rest] = lines.map((line) => line.split(','));
  return { header: lines.length === 0 ? [] : header, rows: rest };
}

/** One section as aligned text: a title with the row count, then the header and rows. */
export function formatSection(section: ReportSection): string {
  const table = parseCsv(section.csv);
  const count = table.rows.length;
  const out = [`== ${section.title} (${count} row${count === 1 ? '' : 's'}) ==`];
  if (count === 0) return [...out, '(none)'].join('\n');
  const all = [table.header, ...table.rows];
  const widths = table.header.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)));
  for (const row of all) {
    out.push(row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join('  ').trimEnd());
  }
  return out.join('\n');
}

/** The whole report: the sections in the order given, separated by a blank line. */
export function formatReport(sections: ReportSection[]): string {
  return sections.map(formatSection).join('\n\n');
}
