import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCriteria, parseManifest } from './config.ts';
import { type ClientFactory, loadRunData, pgClientFactory, pgConfigFromEnv } from './db.ts';
import { renderMarkdown, stableJson } from './render.ts';
import { computeReport } from './report.ts';

export const USAGE =
  'usage: adam-report --life <id> --from <iso> --to <iso> --manifest <file> --out <dir> [--criteria <file>] [--format md|json|both]';

const VALUE_FLAGS = [
  '--life',
  '--from',
  '--to',
  '--out',
  '--manifest',
  '--criteria',
  '--format',
] as const;
const FORMATS = ['md', 'json', 'both'] as const;

export interface CliArgs {
  lifeId: string;
  from: Date;
  to: Date;
  out: string;
  manifest: string;
  criteria: string;
  format: (typeof FORMATS)[number];
}

export type ParseResult = { ok: true; args: CliArgs } | { ok: false; error: string };

const DEFAULT_CRITERIA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'criteria.yaml',
);

function parseIso(name: string, value: string): Date | string {
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(ms))
    return `${name} must be an ISO 8601 time with a T`;
  return new Date(ms);
}

/** Parses argv. Every problem is a usage error (exit 2): an unknown flag, a missing value, a bad time, or an --out inside .git. */
export function parseArgs(argv: string[]): ParseResult {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1];
    if (!(VALUE_FLAGS as readonly string[]).includes(flag))
      return { ok: false, error: `unknown argument ${flag}` };
    if (value === undefined || value.startsWith('--'))
      return { ok: false, error: `${flag} needs a value` };
    if (values.has(flag)) return { ok: false, error: `${flag} given twice` };
    values.set(flag, value);
  }
  for (const flag of ['--life', '--from', '--to', '--out', '--manifest']) {
    if (!values.has(flag)) return { ok: false, error: `missing ${flag}` };
  }
  const format = values.get('--format') ?? 'both';
  if (!(FORMATS as readonly string[]).includes(format))
    return { ok: false, error: '--format must be md, json or both' };
  const from = parseIso('--from', values.get('--from') ?? '');
  const to = parseIso('--to', values.get('--to') ?? '');
  if (typeof from === 'string') return { ok: false, error: from };
  if (typeof to === 'string') return { ok: false, error: to };
  if (from.getTime() > to.getTime()) return { ok: false, error: '--from is after --to' };
  const out = path.resolve(values.get('--out') ?? '');
  if (out.split(path.sep).some((seg) => seg.toLowerCase() === '.git'))
    return { ok: false, error: '--out must not be inside .git' };
  return {
    ok: true,
    args: {
      lifeId: values.get('--life') ?? '',
      from,
      to,
      out,
      manifest: values.get('--manifest') ?? '',
      criteria: values.get('--criteria') ?? DEFAULT_CRITERIA,
      format: format as CliArgs['format'],
    },
  };
}

export interface RunDeps {
  env: NodeJS.ProcessEnv;
  /** Builds the client factory from the environment. A test injects a fake here. */
  connect: (env: NodeJS.ProcessEnv) => ClientFactory;
  now: () => Date;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export const defaultDeps = (log: (line: string) => void): RunDeps => ({
  env: process.env,
  connect: (env) => pgClientFactory(pgConfigFromEnv(env)),
  now: () => new Date(),
  log,
});

/** Runs the tool. Exit 0 when the report is written (verdicts are inside it), 2 for usage, 1 for a read or write failure. */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    deps.log(`adam-report: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { args } = parsed;
  let report: ReturnType<typeof computeReport>;
  let generatedAt: string;
  try {
    const manifest = parseManifest(readFileSync(args.manifest, 'utf8'));
    const criteria = parseCriteria(readFileSync(args.criteria, 'utf8'));
    const factory = deps.connect(deps.env);
    const data = await loadRunData(
      factory,
      { lifeId: args.lifeId, from: args.from, to: args.to },
      deps.signal,
    );
    report = computeReport({ manifest, criteria, data });
    generatedAt = deps.now().toISOString();
  } catch (err) {
    deps.log(`adam-report: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  try {
    mkdirSync(args.out, { recursive: true });
    if (args.format !== 'md') {
      const file = path.join(args.out, 'run-report.json');
      writeFileSync(file, stableJson({ ...report, generatedAt }), { encoding: 'utf8' });
      deps.log(`wrote ${file}`);
    }
    if (args.format !== 'json') {
      const file = path.join(args.out, 'run-report.md');
      writeFileSync(file, renderMarkdown(report, generatedAt), { encoding: 'utf8' });
      deps.log(`wrote ${file}`);
    }
  } catch (err) {
    deps.log(
      `adam-report: could not write the report: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  return 0;
}

// Entry point: only when this file is run directly, never when a test imports it.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  run(process.argv.slice(2), {
    ...defaultDeps((line) => console.error(line)),
    signal: controller.signal,
  }).then((code) => {
    process.exitCode = code;
  });
}
