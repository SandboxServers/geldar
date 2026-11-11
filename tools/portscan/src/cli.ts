import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { tcpConnector } from './connector.ts';
import { parseExpected, parseRange } from './expected.ts';
import { buildReport } from './report.ts';
import { scanPorts } from './scan.ts';

// Defaults are the rate cap: at most 64 connects in flight, at most 200 connect starts a second, 2 attempts
// per port and a 1 s timeout. There is no default target: --target is required.
const DEFAULT_RANGE = '1-65535';
const DEFAULT_CONCURRENCY = 64;
const DEFAULT_PER_SECOND = 200;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 1000;

const USAGE =
  'usage: node src/cli.ts --target <host> --expected <file> [--range LOW-HIGH] [--concurrency N] [--per-second N] [--attempts N] [--timeout-ms N]';

function integer(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`--${name} must be a whole number, got ${value}`);
  return Number(value);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      expected: { type: 'string' },
      range: { type: 'string' },
      concurrency: { type: 'string' },
      'per-second': { type: 'string' },
      attempts: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    strict: true,
  });
  if (values.target === undefined || values.expected === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const range = parseRange(values.range ?? DEFAULT_RANGE);
  const expected = parseExpected(await readFile(values.expected, 'utf8'));
  const ports: number[] = [];
  for (let port = range.low; port <= range.high; port += 1) ports.push(port);

  const startedAt = new Date().toISOString();
  const open = await scanPorts({
    ports,
    connect: tcpConnector(
      values.target,
      integer(values['timeout-ms'], 'timeout-ms', DEFAULT_TIMEOUT_MS),
    ),
    concurrency: integer(values.concurrency, 'concurrency', DEFAULT_CONCURRENCY),
    perSecond: integer(values['per-second'], 'per-second', DEFAULT_PER_SECOND),
    attempts: integer(values.attempts, 'attempts', DEFAULT_ATTEMPTS),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const report = buildReport({ target: values.target, startedAt, range, expected, open });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.verdict === 'pass' ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
