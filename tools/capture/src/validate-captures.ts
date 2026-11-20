#!/usr/bin/env node
// CAP-1: validates a capture directory written by nats-capture.ts against the contract, and prints a pass/fail table.
// Usage, flags and exit codes: tools/capture/README.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  type CheckRow,
  checkCapture,
  checkExpect,
  formatTable,
  parseExpect,
  subjectKind,
} from './capture-checks.ts';
import { metaFileName, readCaptureMetas } from './capture-files.ts';

export interface ValidateOptions {
  /** CAP-2: every break in the folder must name a prior owner (the present case; a null one is INVALID). */
  expectPriorOwner?: boolean;
}

/** A break whose `prior_owner` is null or empty fails when the case expects an owner (CoreProtect present). */
function priorOwnerRow(file: string, text: string): CheckRow {
  let owner: unknown;
  try {
    owner = (JSON.parse(text) as { prior_owner?: unknown }).prior_owner;
  } catch {
    owner = undefined;
  }
  const named = typeof owner === 'string' && owner.length > 0;
  return {
    case: 'break',
    file,
    schema: 'n/a',
    result: named ? 'pass' : 'fail',
    detail: named
      ? `prior_owner=${owner}`
      : 'prior_owner is null: no CoreProtect owner (INVALID for the present case)',
  };
}

/** Validates every captured file of `dir`. A payload with no sidecar has no known subject, so it fails. */
export function validateCaptureDir(
  dir: string,
  expectSpec?: string,
  options: ValidateOptions = {},
): CheckRow[] {
  const expected = expectSpec === undefined ? new Map() : parseExpect(expectSpec);
  const rows: CheckRow[] = [];
  const metas = readCaptureMetas(dir);
  const withSidecar = new Set(metas.map((m) => m.file));
  for (const meta of metas) {
    // A sidecar `file` must be a plain name inside this folder, never a path that reads outside it.
    if (basename(meta.file) !== meta.file) {
      rows.push({
        case: '?',
        file: meta.file,
        schema: 'n/a',
        result: 'fail',
        detail: 'sidecar file is not a plain file name in this folder',
      });
      continue;
    }
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
    if (options.expectPriorOwner === true && subjectKind(meta.subject) === 'break') {
      rows.push(priorOwnerRow(meta.file, text));
    }
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
  let expectPriorOwner = false;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        expect: { type: 'string' },
        'expect-prior-owner': { type: 'boolean', default: false },
      },
      strict: true,
    });
    if (parsed.positionals.length !== 1)
      throw new Error(
        'usage: validate-captures <capture-dir> [--expect case=N,...] [--expect-prior-owner]',
      );
    dir = parsed.positionals[0];
    expect = parsed.values.expect;
    expectPriorOwner = parsed.values['expect-prior-owner'] ?? false;
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
    rows = validateCaptureDir(dir, expect, { expectPriorOwner });
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
