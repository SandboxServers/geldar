// Tests for the sheet adoption verbs (S12-04b): deploy/colo-admin.sh adopt-sheets-plan and adopt-sheets-apply, and the
// adopt-sheets case of tools/admin/admin.sh, which builds the sheets map, runs the plan again inside the one-shot and
// refuses an apply whose plan hash has changed. The verbs run under sh with the fake docker of colo-admin-fixture.ts;
// admin.sh runs from a copy whose ROOT is the fixture directory, with a fake node that records its arguments and prints
// a fixed plan. No container, database or real CLI runs, and no sheet value is printed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calls,
  cleanupFixtures,
  DEPLOY,
  type Fixture,
  fixture,
  posix,
  REAL,
  run,
  SH,
  SPAWN_TEST_TIMEOUT_MS,
  starts,
  writeShim,
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

const ADMIN_SH = resolve(DEPLOY, '..', 'tools', 'admin', 'admin.sh');
const PLAN_LINES = ['ag-b: same', 'ag-a: would-adopt'];
// The hash the script computes: sha256 over the verdict lines, sorted, each with its newline; the first 12 hex digits.
const HASH = createHash('sha256')
  .update(
    [...PLAN_LINES]
      .sort()
      .map((line) => `${line}\n`)
      .join(''),
  )
  .digest('hex')
  .slice(0, 12);

// The fake node: records each call; builds the sheets map for the shard (two lives, "standard"); prints the plan file for
// a plan run, "applied" for an apply run, and fails a plan run when FAKE_FAIL_PLAN is set.
const NODE_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$NODE_LOG"
case "$*" in
  *--input-type=module*) printf '%s' '{"ag-a":"standard","ag-b":"standard"}' ;;
  *adopt-sheets*)
    if [ -n "\${FAKE_FAIL_PLAN:-}" ]; then exit 1; fi
    case "$*" in *--apply*) echo "applied" ;; *) cat "$FAKE_PLAN" ;; esac
    ;;
esac
`;

interface Admin {
  fx: Fixture;
  log: () => string;
  run: (
    args: string[],
    extra?: Record<string, string>,
  ) => { code: number; out: string; err: string };
}

// admin.sh with ROOT moved to the fixture directory, a fake node first on PATH, and the plan file the fake node prints.
function setupAdmin(planLines: string[] = PLAN_LINES): Admin {
  const fx = fixture();
  const src = readFileSync(ADMIN_SH, 'utf8');
  if (!src.includes('ROOT=/opt/geldar'))
    throw new Error('admin.sh no longer sets ROOT=/opt/geldar');
  const sh = join(fx.dir, 'admin.sh');
  writeFileSync(sh, src.replace('ROOT=/opt/geldar', `ROOT=${posix(fx.dir)}`));
  writeShim(join(fx.dir, 'bin'), 'node', NODE_SHIM);
  const plan = join(fx.dir, 'plan.txt');
  writeFileSync(plan, `${planLines.join('\n')}\n`);
  const pg = join(fx.dir, 'pg.txt');
  writeFileSync(pg, 'test-password-not-real\n');
  const shard = join(fx.dir, 'colo.yaml');
  writeFileSync(shard, 'mind:\n  lives: {}\n');
  const nodeLog = join(fx.dir, 'node.log');
  const env = {
    ...fx.env,
    GELDAR_ADMIN_PG_PASSWORD_FILE: posix(pg),
    GELDAR_SHARD_FILE: posix(shard),
    NODE_LOG: posix(nodeLog),
    FAKE_PLAN: posix(plan),
  };
  return {
    fx,
    log: () => (existsSync(nodeLog) ? readFileSync(nodeLog, 'utf8') : ''),
    run: (args, extra = {}) => {
      const r = spawnSync(SH, [posix(sh), ...args], {
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
      return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
    },
  };
}

describe('tools/admin/admin.sh adopt-sheets (S12-04b)', () => {
  it('plan prints the verdict lines in the CLI order and the sorted plan hash, and runs no apply', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'plan']);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`ag-b: same\nag-a: would-adopt\nplan: ${HASH}\n`);
    expect(a.log()).toContain('player adopt-sheets --shard');
    expect(a.log()).not.toContain('--apply');
    expect(r.out).not.toContain('standard');
  });

  it('apply with the hash the operator read runs the apply once, with --operator-confirm', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`plan: ${HASH}`);
    expect(a.log()).toContain('--apply --operator-confirm');
    expect(a.log().match(/--apply/g)).toHaveLength(1);
  });

  it('apply with a different hash refuses, says both hashes, and runs no apply', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'apply', '--operator-confirm', '--plan', '000000000000']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(
      `adopt-sheets-apply: plan changed (expected 000000000000, now ${HASH})`,
    );
    expect(a.log()).not.toContain('--apply');
  });

  it('apply whose plan run fails stops before the hash and runs no apply', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH], {
      FAKE_FAIL_PLAN: '1',
    });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('adopt-sheets plan failed');
    expect(a.log()).not.toContain('--apply');
  });

  it.each([
    ['no --operator-confirm', ['adopt-sheets', 'apply', '--yes', '--plan', HASH]],
    [
      '--operator-confirm after --plan',
      ['adopt-sheets', 'apply', '--plan', HASH, '--operator-confirm'],
    ],
    ['no --plan', ['adopt-sheets', 'apply', '--operator-confirm', '--yes', HASH]],
    [
      'a hash that is not 12 hex digits',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', 'XYZ'],
    ],
    [
      'an extra argument',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH, '--apply'],
    ],
    ['no arguments after apply', ['adopt-sheets', 'apply']],
    ['an extra argument to plan', ['adopt-sheets', 'plan', '--apply']],
  ])('refuses adopt-sheets with %s before the CLI runs', (_name, args) => {
    const a = setupAdmin();
    const r = a.run(args);
    expect(r.code).not.toBe(0);
    expect(a.log()).toBe('');
  });
});

describe('colo-admin.sh adopt-sheets-plan and adopt-sheets-apply (decision 0133)', () => {
  it('plan starts one admin one-shot with the plan argument and no apply', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['adopt-sheets-plan']);
    expect(r.code).toBe(0);
    const s = starts(calls(fx));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/ run --rm --no-deps admin adopt-sheets plan$/);
    expect(s[0]).not.toContain('--apply');
  });

  it('apply starts one admin one-shot with --operator-confirm and the plan hash', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH]);
    expect(r.code).toBe(0);
    const s = starts(calls(fx));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(
      new RegExp(` run --rm --no-deps admin adopt-sheets apply --operator-confirm --plan ${HASH}$`),
    );
  });

  it('a dry run of apply prints the command and starts no container', () => {
    const fx = fixture();
    const r = run(fx, {}, ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run, not run');
    expect(starts(calls(fx))).toEqual([]);
  });

  it.each([
    ['an argument to plan', ['adopt-sheets-plan', '--apply']],
    ['--operator-confirm to plan', ['adopt-sheets-plan', '--operator-confirm']],
    ['no arguments to apply', ['adopt-sheets-apply']],
    ['no --operator-confirm', ['adopt-sheets-apply', '--yes', '--plan', HASH]],
    [
      '--operator-confirm after --plan',
      ['adopt-sheets-apply', '--plan', HASH, '--operator-confirm'],
    ],
    ['no --plan', ['adopt-sheets-apply', '--operator-confirm', '--yes', HASH]],
    [
      'an extra argument to apply',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH, '--apply'],
    ],
    [
      'a hash with capitals',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', 'ABCDEF012345'],
    ],
    ['a hash of 11 digits', ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH.slice(1)]],
  ])('refuses %s before any container starts', (_name, args) => {
    const fx = fixture();
    const r = run(fx, REAL, args);
    expect(r.code).not.toBe(0);
    expect(starts(calls(fx))).toEqual([]);
  });
});
