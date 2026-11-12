import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { aggregate } from './aggregate.ts';
import { parseBodyLog } from './body.ts';
import { parseInventory } from './inventory.ts';
import { parsePaperLog } from './paper.ts';
import { parsePositions } from './positions.ts';
import { renderCsv, renderMarkdown } from './render.ts';
import { parseThoughts } from './thoughts.ts';

const USAGE = `usage: node src/cli.ts [--paper <file|->] [--date YYYY-MM-DD] [--body <file>] [--agent <id>]
  [--positions <csv>] [--inventory <csv>] [--thoughts <json>] [--window-minutes N] [--csv <out file>]
Reads only. "-" for --paper reads stdin (docker logs output). Markdown goes to stdout.`;

function read(path: string): string {
  return readFileSync(path === '-' ? 0 : path, 'utf8');
}

function main(): number {
  const { values } = parseArgs({
    options: {
      paper: { type: 'string' },
      date: { type: 'string' },
      body: { type: 'string' },
      agent: { type: 'string' },
      positions: { type: 'string' },
      inventory: { type: 'string' },
      thoughts: { type: 'string' },
      'window-minutes': { type: 'string' },
      csv: { type: 'string' },
    },
    strict: true,
  });
  const windowMinutes = Number(values['window-minutes'] ?? '0');
  if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
    process.stderr.write(`--window-minutes must be a number >= 0\n${USAGE}\n`);
    return 2;
  }
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) {
    process.stderr.write(`--date must be YYYY-MM-DD\n${USAGE}\n`);
    return 2;
  }
  const inputs = {
    paper: values.paper ? parsePaperLog(read(values.paper), base) : [],
    body: values.body ? parseBodyLog(read(values.body), values.agent ?? null) : [],
    positions: values.positions ? parsePositions(read(values.positions)) : [],
    inventory: values.inventory ? parseInventory(read(values.inventory)) : [],
    thoughts: values.thoughts ? parseThoughts(read(values.thoughts)) : [],
  };
  const rows = aggregate(inputs, windowMinutes * 60_000);
  if (rows.length === 0) {
    process.stderr.write(`no data\n${USAGE}\n`);
    return 2;
  }
  process.stdout.write(renderMarkdown(rows));
  const csv = renderCsv(rows);
  if (values.csv) writeFileSync(values.csv, csv);
  else process.stdout.write(`\n${csv}`);
  return 0;
}

process.exitCode = main();
