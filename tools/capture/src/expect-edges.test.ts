// CAP-fix-1: parseExpect edge cases, the sidecar file-name check, and the --expect-prior-owner option.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseExpect } from './capture-checks.ts';
import { validateCaptureDir } from './validate-captures.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures-synthetic', import.meta.url));
let dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('parseExpect edge cases', () => {
  it('refuses an empty count: take= is not a zero', () => {
    expect(() => parseExpect('take=')).toThrow(/bad count/);
  });

  it('refuses a negative count', () => {
    expect(() => parseExpect('take=-1')).toThrow(/bad count/);
  });

  it('refuses a doubled equals sign', () => {
    expect(() => parseExpect('take=1=2')).toThrow(/bad count/);
  });

  it('still reads take=0 as an exact zero and two-digit counts as they are', () => {
    const spec = parseExpect('take=0,break=12');
    expect(spec.get('take')).toBe(0);
    expect(spec.get('break')).toBe(12);
  });

  it('reads the two-part combat spec of the kill and survived cases', () => {
    expect(parseExpect('combat_fact=1,combat=1').get('combat')).toBe(1);
  });
});

describe('validator: the sidecar file name', () => {
  it('fails a sidecar whose file reaches outside its folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-edge-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'x.meta.json'),
      JSON.stringify({
        seq: 1,
        subject: 'geldar.phase0.provenance.take',
        received_at: '2026-11-19T12:00:00.000Z',
        bytes: 1,
        file: '../escape.json',
      }),
    );
    const rows = validateCaptureDir(dir);
    expect(rows.some((r) => r.result === 'fail' && /plain file name/.test(r.detail))).toBe(true);
  });
});

describe('validator: --expect-prior-owner', () => {
  it('fails a break whose prior_owner is null, and only when the option is given', () => {
    // The synthetic break has prior_owner null (the no-CoreProtect shape).
    const withOption = validateCaptureDir(FIXTURES, undefined, { expectPriorOwner: true });
    expect(
      withOption.some((r) => r.result === 'fail' && /prior_owner is null/.test(r.detail)),
    ).toBe(true);
    const without = validateCaptureDir(FIXTURES);
    expect(without.some((r) => /prior_owner is null/.test(r.detail))).toBe(false);
  });
});
