import type { Row } from './aggregate.ts';

const pct = (v: number | null): string => (v === null ? '' : `${(v * 100).toFixed(0)}%`);
const num = (v: number | null, d = 1): string => (v === null ? '' : v.toFixed(d));
const iso = (t: number): string => new Date(t).toISOString().slice(0, 16);

/** The headline columns of the markdown table. */
export function renderMarkdown(rows: Row[]): string {
  const head = [
    'agent',
    'window',
    'first tool (min)',
    'deaths/h',
    'chunks',
    'stuck (s)',
    'repeated journal',
    'no_effect',
    'escape success',
  ];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    const cells = [
      r.agent,
      iso(r.windowStart),
      num(r.timeToFirstToolMin),
      num(r.deathsPerHour, 2),
      String(r.chunks),
      num(r.stuckSeconds, 0),
      pct(r.repeatedJournalShare),
      pct(r.noEffectShare),
      pct(r.escapeSuccessRate),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? String(Number.isInteger(v) ? v : Number(v.toFixed(4))) : v;
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Every Row field, with the window as ISO times. */
export function renderCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0] as Row) as (keyof Row)[];
  const out = [keys.join(',')];
  for (const r of rows) {
    out.push(
      keys
        .map((k) =>
          csvCell(k === 'windowStart' || k === 'windowEnd' ? new Date(r[k]).toISOString() : r[k]),
        )
        .join(','),
    );
  }
  return `${out.join('\n')}\n`;
}
