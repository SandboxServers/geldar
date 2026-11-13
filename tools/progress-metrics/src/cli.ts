import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { aggregate, DEFAULT_MIN_EVENTS, type Inputs, type Row } from './aggregate.ts';
import { parseBodyLog } from './body.ts';
import { renderTopFailures, topFailures } from './failures.ts';
import { readMany } from './files.ts';
import { parseInventory } from './inventory.ts';
import { parseOutcomes } from './outcomes.ts';
import { parsePaperLog } from './paper.ts';
import { parsePositions } from './positions.ts';
import { renderCsv, renderMarkdown } from './render.ts';
import { parseThoughts } from './thoughts.ts';
import { cutInputs, parseWindows } from './window.ts';

const USAGE = `usage: node src/cli.ts [--paper <file|->] [--date YYYY-MM-DD] [--body <file|glob>]... [--outcomes <file|glob>]...
  [--agent <id>]
  [--since <iso>] [--until <iso>] [--windows <json file>] [--min-events N]
  [--positions <csv>] [--inventory <csv>] [--thoughts <json>] [--window-minutes N] [--csv <out file>]
Reads only. "-" for --paper reads stdin (docker logs output). Markdown goes to stdout.
--body and --outcomes may repeat and take a file-name glob; the agent of a Body file is its single life_id,
else the id in its name, else (unknown).
--since/--until cut every input to [since, until). --windows takes [{name,start,end}] (ISO times) and gives one
table section per named window; it cannot be combined with --window-minutes. Windows with fewer than --min-events
(default ${DEFAULT_MIN_EVENTS}) events print "insufficient data" and the range covered.`;

function read(path: string): string {
  return readFileSync(path === '-' ? 0 : path, 'utf8');
}

function main(): number {
  const { values } = parseArgs({
    options: {
      paper: { type: 'string' },
      date: { type: 'string' },
      body: { type: 'string', multiple: true },
      outcomes: { type: 'string', multiple: true },
      agent: { type: 'string' },
      positions: { type: 'string' },
      inventory: { type: 'string' },
      thoughts: { type: 'string' },
      'window-minutes': { type: 'string' },
      csv: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      windows: { type: 'string' },
      'min-events': { type: 'string' },
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
  const minEvents = Number(values['min-events'] ?? DEFAULT_MIN_EVENTS);
  const since = values.since ? Date.parse(values.since) : null;
  const until = values.until ? Date.parse(values.until) : null;
  if (!Number.isFinite(minEvents) || minEvents < 0 || Number.isNaN(since) || Number.isNaN(until)) {
    process.stderr.write(`--min-events must be >= 0; --since and --until ISO times\n${USAGE}\n`);
    return 2;
  }
  if (values.windows && windowMinutes > 0) {
    process.stderr.write(`--windows and --window-minutes cannot be combined\n${USAGE}\n`);
    return 2;
  }
  const inputs: Inputs = {
    paper: values.paper ? parsePaperLog(read(values.paper), base) : [],
    body: [
      ...readMany(values.body ?? [], values.agent ?? null, parseBodyLog),
      ...readMany(values.outcomes ?? [], values.agent ?? null, parseOutcomes),
    ],
    positions: values.positions ? parsePositions(read(values.positions)) : [],
    inventory: values.inventory ? parseInventory(read(values.inventory)) : [],
    thoughts: values.thoughts ? parseThoughts(read(values.thoughts)) : [],
  };
  const cut = cutInputs(inputs, since, until);
  let rows: Row[];
  if (values.windows) {
    const wins = parseWindows(read(values.windows));
    const agents = [...new Set(Object.values(inputs).flatMap((l) => l.map((e) => e.agent)))];
    rows = wins.flatMap((w) =>
      aggregate(cutInputs(cut, w.start, w.end), 0, {
        minEvents,
        name: w.name,
        range: { start: w.start, end: w.end },
        agents,
      }),
    );
  } else {
    rows = aggregate(cut, windowMinutes * 60_000, { minEvents });
  }
  if (rows.length === 0) {
    process.stderr.write(`no data\n${USAGE}\n`);
    return 2;
  }
  process.stdout.write(renderMarkdown(rows));
  process.stdout.write(renderTopFailures(topFailures(cut.body)));
  const csv = renderCsv(rows);
  if (values.csv) writeFileSync(values.csv, csv);
  else process.stdout.write(`\n${csv}`);
  return 0;
}

process.exitCode = main();
