import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export type Page = { thoughts: unknown[]; next: string | null };

/**
 * Pages Glass `/api/thoughts` (newest first, at most 100 a request) with the `next` cursor until `count`
 * thoughts are collected, the cursor is null, or a page is empty. Read only.
 */
export async function collectThoughts(
  fetchPage: (cursor: string | null) => Promise<Page>,
  count: number,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | null = null;
  while (all.length < count) {
    const page = await fetchPage(cursor);
    if (page.thoughts.length === 0) break;
    all.push(...page.thoughts);
    if (page.next === null) break;
    cursor = page.next;
  }
  return all.slice(0, count);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'http://127.0.0.1:8787' },
      count: { type: 'string', default: '1000' },
      agent: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || !values.out) {
    process.stderr.write(
      'usage: node export-glass.ts --out <file> [--count N] [--base URL] [--agent <life id>]\n',
    );
    return 2;
  }
  const fetchPage = async (cursor: string | null): Promise<Page> => {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor !== null) q.set('cursor', cursor);
    if (values.agent) q.set('agent', values.agent);
    const res = await fetch(`${values.base}/api/thoughts?${q}`);
    if (!res.ok) throw new Error(`Glass answered ${res.status}`);
    const body = (await res.json()) as { thoughts?: unknown[]; next?: string | null };
    return { thoughts: body.thoughts ?? [], next: body.next ?? null };
  };
  const thoughts = await collectThoughts(fetchPage, count);
  writeFileSync(values.out, JSON.stringify({ thoughts }));
  process.stderr.write(`wrote ${thoughts.length} thoughts\n`);
  return 0;
}

if (process.argv[1]?.endsWith('export-glass.ts')) process.exitCode = await main();
