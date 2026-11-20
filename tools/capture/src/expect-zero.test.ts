// CAP-2: `--expect kind=0` means exactly zero captured files of that kind (a send-nothing case). A non-zero
// count stays "at least" (CAP-1). These tests fail on the CAP-1 rule, where `found >= 0` always passed.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCapture } from './capture-files.ts';
import { validateCaptureDir } from './validate-captures.ts';

const TAKE = 'geldar.phase0.provenance.take';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'cap2-expect-zero-'));
}

describe('--expect kind=0 is exact (send-nothing cases)', () => {
  it('an empty folder passes take=0', () => {
    const rows = validateCaptureDir(freshDir(), 'take=0');
    const row = rows.find((r) => r.case === 'take' && r.file === '-');
    expect(row?.result).toBe('pass');
    expect(row?.detail).toBe('expected at least 0, found 0');
  });

  it('a take file in a folder that expects none fails take=0', () => {
    const dir = freshDir();
    writeCapture(dir, 1, TAKE, new TextEncoder().encode('{}'), new Date(0));
    const row = validateCaptureDir(dir, 'take=0').find((r) => r.case === 'take' && r.file === '-');
    expect(row?.result).toBe('fail');
    expect(row?.detail).toBe('expected none, found 1');
  });

  it('a non-zero count is still "at least": one take file passes take=1', () => {
    const dir = freshDir();
    writeCapture(dir, 1, TAKE, new TextEncoder().encode('{}'), new Date(0));
    const row = validateCaptureDir(dir, 'take=1').find((r) => r.case === 'take' && r.file === '-');
    expect(row?.result).toBe('pass');
    expect(row?.detail).toBe('expected at least 1, found 1');
  });
});
