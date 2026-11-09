import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMeta } from './meta.ts';
import { percentile } from './stats.ts';
import type { CellResult } from './types.ts';

/** p50 and p95 of one list, `null` when it is empty. */
export interface Percentiles {
  p50: number | null;
  p95: number | null;
}

/** One summary line per cell: success and latency, overall, per action kind and in world ticks. */
export interface Row {
  scenario: string;
  tps: number;
  runs: number;
  passed: number;
  /** Passed over runs as a percentage, or null for zero runs. */
  successPct: number | null;
  /** Wall latency of completed actions, rounded ms. */
  latencyMs: Percentiles;
  /** World ticks of completed actions; each value has a 20-tick resolution (decision 0038). */
  worldTicks: Percentiles;
  byKind: Record<string, Percentiles & { total: number; completed: number }>;
  actionsOk: number;
  actionsTotal: number;
}

/** What `writeResults` needs besides the cells. */
export interface ResultInput {
  meta: RunMeta;
  cells: CellResult[];
  truncated: boolean;
  note: string;
}

const TABLE_COLUMNS = 12;

/** A percentile of a list as a number, `null` when the list is empty. */
function pct(values: number[], p: number): number | null {
  const value = percentile(values, p);
  return Number.isNaN(value) ? null : value;
}

function percentiles(values: number[]): Percentiles {
  return { p50: pct(values, 50), p95: pct(values, 95) };
}

/** Builds the summary rows from the cells. Latency counts completed actions only. */
export function summarize(cells: CellResult[]): Row[] {
  return cells.map((cell) => {
    const done = cell.actions.filter((a) => a.status === 'completed');
    const ticks = done.flatMap((a) => (a.worldTicks === null ? [] : [a.worldTicks]));
    const byKind: Row['byKind'] = {};
    for (const [kind, stats] of Object.entries(cell.actionStats)) {
      const latencies = done.filter((a) => a.kind === kind).map((a) => a.latencyMs);
      byKind[kind] = { total: stats.total, completed: stats.completed, ...percentiles(latencies) };
    }
    return {
      scenario: cell.scenario,
      tps: cell.tps,
      runs: cell.runs,
      passed: cell.passed,
      successPct: cell.runs === 0 ? null : (cell.passed / cell.runs) * 100,
      latencyMs: percentiles(done.map((a) => a.latencyMs)),
      worldTicks: percentiles(ticks),
      byKind,
      actionsOk: done.length,
      actionsTotal: cell.actions.length,
    };
  });
}

/** `YYYYMMDDTHHmmssZ-<commit>.json`: no colons, which NTFS rejects. */
export function resultFileName(meta: Pick<RunMeta, 'stamp' | 'commit'>): string {
  return `${meta.stamp}-${meta.commit}.json`;
}

/** A Markdown table cell: `|` escaped, newlines flattened. */
function cell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
}

/** One Markdown row (12 cells) for a cell of the run. */
export function markdownRow(
  meta: RunMeta,
  row: Row,
  extra: { note: string; file: string; truncated?: boolean },
): string {
  const ms = (value: number | null): string => (value === null ? 'n/a' : String(Math.round(value)));
  const success =
    row.successPct === null ? 'n/a' : `${row.passed}/${row.runs} (${Math.round(row.successPct)}%)`;
  const parts = [
    extra.note,
    `actions ${row.actionsOk}/${row.actionsTotal}`,
    extra.truncated ? 'truncated' : '',
    `bench-runs/${extra.file}`,
  ].filter((part) => part !== '');
  const cells = [
    meta.date,
    meta.commit,
    meta.minecraft,
    meta.paperBuild,
    meta.mineflayer,
    String(row.tps),
    row.scenario,
    String(row.runs),
    success,
    ms(row.latencyMs.p50),
    ms(row.latencyMs.p95),
    parts.join('; '),
  ];
  if (cells.length !== TABLE_COLUMNS) throw new Error('bench row must have 12 cells');
  return `| ${cells.map(cell).join(' | ')} |`;
}

/**
 * Inserts rows after the last table row of a Markdown file. Pure: keeps the file's LF or CRLF
 * endings and its final newline (or the lack of one). Throws when the text has no table.
 */
export function appendRows(markdown: string, rows: string[]): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let last = -1;
  for (let i = 0; i < lines.length; i++) if ((lines[i] as string).startsWith('|')) last = i;
  if (last === -1) throw new Error('bench-results.md has no table to append to');
  lines.splice(last + 1, 0, ...rows);
  return lines.join(eol);
}

/** Where `writeResults` writes. */
export interface WriteOptions {
  /** The repository root. */
  root: string;
  record: boolean;
}

/** What `writeResults` wrote. */
export interface Written {
  file: string;
  recordedFile: string | null;
  summary: Row[];
}

/**
 * Writes `bench-results/<name>.json` under the repo root. With `record` it also copies the JSON to
 * `docs/analysis/phase0/bench-runs/` and appends one row per cell to `bench-results.md`.
 */
export async function writeResults(input: ResultInput, opts: WriteOptions): Promise<Written> {
  const summary = summarize(input.cells);
  const body = `${JSON.stringify(
    {
      meta: { ...input.meta, worldAgeResolutionTicks: 20 },
      truncated: input.truncated,
      note: input.note,
      cells: input.cells,
      summary,
    },
    null,
    2,
  )}\n`;
  const name = resultFileName(input.meta);
  const dir = join(opts.root, 'bench-results');
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, body, 'utf8');
  if (!opts.record) return { file, recordedFile: null, summary };

  const runsDir = join(opts.root, 'docs', 'analysis', 'phase0', 'bench-runs');
  await mkdir(runsDir, { recursive: true });
  const recordedFile = join(runsDir, name);
  await writeFile(recordedFile, body, 'utf8');
  const tablePath = join(opts.root, 'docs', 'analysis', 'phase0', 'bench-results.md');
  const rows = summary.map((row) =>
    markdownRow(input.meta, row, { note: input.note, file: name, truncated: input.truncated }),
  );
  await writeFile(tablePath, appendRows(await readFile(tablePath, 'utf8'), rows), 'utf8');
  return { file, recordedFile, summary };
}
