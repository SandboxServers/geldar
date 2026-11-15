/**
 * Sheet driver step 0 helper CLI. Called by bench/sheet/run.sh. Nothing here writes to a shard.
 *
 *   node --experimental-strip-types golem/src/bench/sheet/cli.ts guard <shard> <project>
 *   node --experimental-strip-types golem/src/bench/sheet/cli.ts leak <capture file> <sheet numbers, comma list>
 *   node --experimental-strip-types golem/src/bench/sheet/cli.ts report <title=csv file> ...
 *
 * Exit: 0 ok, 1 refused (guard) or a leak hit, 2 usage error or a crash (the error is printed).
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { checkScratch } from './guard.ts';
import { leakHits } from './leak-check.ts';
import { formatReport, type ReportSection } from './report.ts';

const USAGE =
  'usage: cli.ts guard <shard> <project> | leak <file> <numbers> | report <title=csv file> ...';

export async function main(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    console.error(`sheet cli failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'guard' && rest.length === 2) {
    const verdict = checkScratch(rest[0] ?? '', rest[1] ?? '');
    console.log(verdict.reason);
    return verdict.ok ? 0 : 1;
  }
  if (command === 'leak' && rest.length === 2) {
    const text = await readFile(rest[0] ?? '', 'utf8');
    const numbers = (rest[1] ?? '').split(',').map(Number);
    const hits = leakHits(text, numbers);
    console.log(hits.length === 0 ? 'leak check: clean' : `leak check: HITS ${hits.join(' ')}`);
    return hits.length === 0 ? 0 : 1;
  }
  if (command === 'report' && rest.length > 0) {
    const sections: ReportSection[] = [];
    for (const arg of rest) {
      const eq = arg.indexOf('=');
      if (eq < 1) {
        console.error(USAGE);
        return 2;
      }
      sections.push({ title: arg.slice(0, eq), csv: await readFile(arg.slice(eq + 1), 'utf8') });
    }
    console.log(formatReport(sections));
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
