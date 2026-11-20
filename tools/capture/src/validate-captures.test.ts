import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeCapture } from './capture-files.ts';
import { runValidateCli, validateCaptureDir } from './validate-captures.ts';

// The hand-built folder (not captures): one break, one take, one combat_fact.
const FIXTURES = fileURLToPath(new URL('../fixtures-synthetic', import.meta.url));
const P = 'geldar.phase0.provenance';
const PICKUP = {
  kind: 'pickup',
  world: 'world',
  picker: 'GolemPick',
  thrower: null,
  item: 'stick',
  count: 3,
  age_ticks: 40,
  distance: null,
  tick: 1200,
};
const at = new Date('2026-11-19T12:00:00Z');

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cap1-validate-'));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh capture directory under the scratch root, with the given messages written by the real writer. */
function dirWith(name: string, messages: Array<[string, unknown]>): string {
  const dir = join(scratch, name);
  messages.forEach(([subject, value], i) => {
    writeCapture(dir, i + 1, subject, Buffer.from(JSON.stringify(value)), at);
  });
  return dir;
}

function failing(rows: { result: string }[]): number {
  return rows.filter((r) => r.result === 'fail').length;
}

describe('validateCaptureDir', () => {
  it('passes the hand-built folder: every file is valid and every claim row is printed', () => {
    const rows = validateCaptureDir(FIXTURES);
    expect(failing(rows)).toBe(0);
    expect(rows.map((r) => r.case).sort()).toEqual(
      ['break', 'combat_fact', 'combat_fact', 'combat_fact', 'take'].sort(),
    );
  });

  it('fails a case that has fewer files than --expect asks for, and passes the others', () => {
    const rows = validateCaptureDir(FIXTURES, 'break=2,take=1');
    expect(rows.filter((r) => r.result === 'fail').map((r) => r.detail)).toEqual([
      'expected at least 2, found 1',
    ]);
  });

  it('fails a payload that is valid JSON but breaks the contract (count 0 in a pickup)', () => {
    const dir = dirWith('bad-pickup', [[`${P}.pickup`, { ...PICKUP, count: 0 }]]);
    const rows = validateCaptureDir(dir);
    expect(rows[0]).toMatchObject({ case: 'pickup', schema: 'fail', result: 'fail' });
  });

  it('fails a file whose sidecar names an unknown subject', () => {
    const dir = dirWith('unknown', [['geldar.phase0.provenance.other', PICKUP]]);
    expect(validateCaptureDir(dir)[0]).toMatchObject({ case: '?', result: 'fail' });
  });

  it('fails a payload file that has no sidecar, because its subject is unknown', () => {
    const dir = dirWith('no-sidecar', [[`${P}.pickup`, PICKUP]]);
    writeFileSync(join(dir, '000009-stray.json'), '{}');
    expect(validateCaptureDir(dir).some((r) => r.detail.startsWith('no sidecar'))).toBe(true);
  });
});

describe('runValidateCli exit codes', () => {
  function captureOutput(): { text: () => string } {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return { text: () => chunks.join('') };
  }

  it('exits 0 on the hand-built folder and prints the table', () => {
    const out = captureOutput();
    expect(runValidateCli([FIXTURES])).toBe(0);
    expect(out.text()).toContain('0 failing');
  });

  it('exits 1 when any row fails', () => {
    const dir = dirWith('exit-one', [[`${P}.pickup`, { ...PICKUP, count: 0 }]]);
    captureOutput();
    expect(runValidateCli([dir])).toBe(1);
  });

  it('exits 2 on a usage error and on a missing directory', () => {
    captureOutput();
    expect(runValidateCli([])).toBe(2);
    expect(runValidateCli([join(scratch, 'does-not-exist')])).toBe(2);
    expect(runValidateCli([FIXTURES, '--expect', 'nope=1'])).toBe(2);
  });
});
