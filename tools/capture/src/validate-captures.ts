#!/usr/bin/env node
// CAP-1: validates a capture directory written by nats-capture.ts against the contract, and prints a pass/fail table.
// Usage, flags and exit codes: tools/capture/README.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  type CheckRow,
  checkCapture,
  checkExpect,
  formatTable,
  parseExpect,
} from './capture-checks.ts';
import { metaFileName, readCaptureMetas } from './capture-files.ts';

/** Validates every captured file of `dir`. A payload with no sidecar has no known subject, so it fails. */
export function validateCaptureDir(dir: string, expectSpec?: string): CheckRow[] {
  const expected = expectSpec === undefined ? new Map() : parseExpect(expectSpec);
  const rows: CheckRow[] = [];
  const metas = readCaptureMetas(dir);
  const withSidecar = new Set(metas.map((m) => m.file));
  for (const meta of metas) {
    let text: string;
    try {
      text = readFileSync(join(dir, meta.file), 'utf8');
    } catch {
      rows.push({
        case: '?',
        file: meta.file,
        schema: 'n/a',
        result: 'fail',
        detail: 'payload file missing',
      });
      continue;
    }
    rows.push(...checkCapture({ file: meta.file, subject: meta.subject, text }));
  }
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.endsWith('.meta.json') || withSidecar.has(name)) continue;
    rows.push({
      case: '?',
      file: name,
      schema: 'n/a',
      result: 'fail',
      detail: `no sidecar ${metaFileName(name)}`,
    });
  }
  rows.push(...checkExpect(rows, expected));
  return rows;
}

/** The CLI body: prints the table and returns the exit code (0 all pass, 1 a failing row, 2 a usage error). */
export function runValidateCli(argv: string[]): number {
  let dir: string | undefined;
  let expect: string | undefined;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { expect: { type: 'string' } },
      strict: true,
    });
    if (parsed.positionals.length !== 1)
      throw new Error('usage: validate-captures <capture-dir> [--expect case=N,...]');
    dir = parsed.positionals[0];
    expect = parsed.values.expect;
  } catch (error) {
    process.stderr.write(`validate-captures: ${(error as Error).message}\n`);
    return 2;
  }
  if (dir === undefined || !existsSync(dir)) {
    process.stderr.write(`validate-captures: no such capture directory: ${String(dir)}\n`);
    return 2;
  }
  let rows: CheckRow[];
  try {
    rows = validateCaptureDir(dir, expect);
  } catch (error) {
    process.stderr.write(`validate-captures: ${(error as Error).message}\n`);
    return 2;
  }
  process.stdout.write(`${formatTable(rows)}\n`);
  const failing = rows.filter((r) => r.result === 'fail').length;
  process.stdout.write(`${rows.length} row(s), ${failing} failing\n`);
  return failing === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runValidateCli(process.argv.slice(2));
}
