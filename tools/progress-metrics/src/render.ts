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
    'episode success',
    'stall lines',
    'rungs',
    'forced_move',
    'max corr/10s',
    'high corr',
    'note',
  ];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    const n = r.insufficient === 1 ? 'n/a' : null;
    const note = [
      r.insufficient === 1
        ? `insufficient data (${r.events} events, covered ${r.dataFrom ? `${r.dataFrom.slice(0, 16)} to ${r.dataTo.slice(0, 16)}` : 'nothing'})`
        : '',
      r.rubberBanding,
      r.positionNote,
    ].filter(Boolean);
    const cells = [
      r.agent,
      r.window || iso(r.windowStart),
      num(r.timeToFirstToolMin),
      n ?? num(r.deathsPerHour, 2),
      n ?? String(r.chunks),
      n ?? num(r.stuckSeconds, 0),
      n ?? pct(r.repeatedJournalShare),
      n ?? pct(r.noEffectShare),
      n ?? pct(r.escapeSuccessRate),
      n ?? pct(r.episodeSuccessRate),
      String(r.stallDiag),
      String(r.rungLines),
      String(r.forcedMoves),
      num(r.maxCorrections10s, 0),
      pct(r.highCorrectionShare),
      note.join('; '),
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
