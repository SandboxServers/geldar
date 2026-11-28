// Tests for the sheet adoption verbs (S12-04b): deploy/colo-admin.sh adopt-sheets-plan and adopt-sheets-apply, and the
// adopt-sheets case of tools/admin/admin.sh, which builds the sheets map for the listed lives (--lives), runs the plan again
// inside the one-shot and refuses an apply whose plan hash has changed. The verbs run under sh with the fake docker of
// colo-admin-fixture.ts. admin.sh runs from a copy whose ROOT is the repo, so the real map builder (readShardLives) runs on
// a fixture shard; the fake node runs that step with the real node and fakes the CLI: it records its arguments, copies the
// sheets map it was given, and prints one "<life>: would-adopt" line per life in that map. No container, database or real
// CLI runs, and no sheet value is printed.
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
const REPO = resolve(DEPLOY, '..');
// The shard the admin one-shot reads: three lives, two of them listed in the restricted tests.
const SHARD = `mind:
  lives: {}
sovereign:
  players:
    - { player_id: ag-a-01, life_id: ag_a_01, name: A }
    - { player_id: ag-b-01, life_id: ag_b_01, name: B }
    - { player_id: ag-c-01, life_id: ag_c_01, name: C }
`;
const ALL = ['ag_a_01', 'ag_b_01', 'ag_c_01'];
const LIST = 'ag_a_01,ag_b_01';
const LIVES = ['ag_a_01', 'ag_b_01'];
const LIST_ALL = ALL.join(',');
// The plan hash the script computes: sha256 over the verdict lines, sorted, each with its newline; the first 12 hex digits.
const planHash = (lives: string[]) =>
  createHash('sha256')
    .update(
      lives
        .map((life) => `${life}: would-adopt`)
        .sort()
        .map((line) => `${line}\n`)
        .join(''),
    )
    .digest('hex')
    .slice(0, 12);
const HASH = planHash(LIVES);
const HASH_ALL = planHash(ALL);
const TOO_MANY = Array.from({ length: 121 }, (_, i) => `ag_a${i}_01`).join(',');

// The fake node. The map step (--input-type=module) runs the real node. The CLI step ("adopt-sheets" in its arguments) copies
// the sheets map to $FAKE_SHEETS_OUT and prints "<life>: would-adopt" per key, or "applied" for an apply run; it fails a plan
// run when FAKE_FAIL_PLAN is set. The map is {"id":"standard",...}, so the shell reads its keys with parameter expansion.
const NODE_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$NODE_LOG"
case "$*" in
  *--input-type=module*) exec "$REAL_NODE" "$@" ;;
  *adopt-sheets*)
    if [ -n "\${FAKE_FAIL_PLAN:-}" ]; then exit 1; fi
    sheets=
    prev=
    for a in "$@"; do
      if [ "$prev" = --sheets ]; then sheets=$a; fi
      prev=$a
    done
    cat "$sheets" > "$FAKE_SHEETS_OUT"
    case "$*" in
      *--apply*) echo "applied" ;;
      *)
        s=$(cat "$sheets")
        s=\${s#\\{}
        s=\${s%\\}}
        IFS=,
        for item in $s; do
          k=\${item%%:*}
          k=\${k#\\"}
          k=\${k%\\"}
          echo "$k: would-adopt"
        done
        ;;
    esac
    ;;
esac
`;

interface Admin {
  fx: Fixture;
  log: () => string;
  sheets: () => Record<string, string> | undefined;
  run: (
    args: string[],
    extra?: Record<string, string>,
  ) => { code: number; out: string; err: string };
}

// admin.sh with ROOT moved to the repo, a fake node first on PATH, and the fixture shard.
function setupAdmin(): Admin {
  const fx = fixture();
  const src = readFileSync(ADMIN_SH, 'utf8');
  if (!src.includes('ROOT=/opt/geldar'))
    throw new Error('admin.sh no longer sets ROOT=/opt/geldar');
  const sh = join(fx.dir, 'admin.sh');
  writeFileSync(sh, src.replace('ROOT=/opt/geldar', `ROOT=${posix(REPO)}`));
  writeShim(join(fx.dir, 'bin'), 'node', NODE_SHIM);
  const pg = join(fx.dir, 'pg.txt');
  writeFileSync(pg, 'test-password-not-real\n');
  const shard = join(fx.dir, 'colo.yaml');
  writeFileSync(shard, SHARD);
  const nodeLog = join(fx.dir, 'node.log');
  const sheetsOut = join(fx.dir, 'sheets.json');
  const env = {
    ...fx.env,
    GELDAR_ADMIN_PG_PASSWORD_FILE: posix(pg),
    GELDAR_SHARD_FILE: posix(shard),
    NODE_LOG: posix(nodeLog),
    FAKE_SHEETS_OUT: posix(sheetsOut),
    REAL_NODE: posix(process.execPath),
  };
  return {
    fx,
    log: () => (existsSync(nodeLog) ? readFileSync(nodeLog, 'utf8') : ''),
    sheets: () =>
      existsSync(sheetsOut)
        ? (JSON.parse(readFileSync(sheetsOut, 'utf8')) as Record<string, string>)
        : undefined,
    run: (args, extra = {}) => {
      const r = spawnSync(SH, [posix(sh), ...args], {
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
      return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
    },
  };
}

describe('tools/admin/admin.sh adopt-sheets (S12-04b, ADOPT-LIVES)', () => {
  it('plan for a list prints the verdict lines of the listed lives and the hash of exactly those lines', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'plan', '--lives', LIST]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`ag_a_01: would-adopt\nag_b_01: would-adopt\nplan: ${HASH}\n`);
    expect(a.log()).toContain('player adopt-sheets --shard');
    expect(a.log()).not.toContain('--apply');
    expect(r.out).not.toContain('standard');
  });

  it('the sheets map holds only the listed lives, each standard', () => {
    const a = setupAdmin();
    expect(a.run(['adopt-sheets', 'plan', '--lives', LIST]).code).toBe(0);
    expect(a.sheets()).toEqual({ ag_a_01: 'standard', ag_b_01: 'standard' });
  });

  it('two different lists give two different plan hashes', () => {
    const a = setupAdmin();
    const small = a.run(['adopt-sheets', 'plan', '--lives', LIST]);
    const all = a.run(['adopt-sheets', 'plan', '--lives', LIST_ALL]);
    expect(small.out).toContain(`plan: ${HASH}\n`);
    expect(all.out).toContain(`plan: ${HASH_ALL}\n`);
    expect(HASH).not.toBe(HASH_ALL);
  });

  it('apply with the hash of the same list runs the apply once, with --operator-confirm', () => {
    const a = setupAdmin();
    const r = a.run([
      'adopt-sheets',
      'apply',
      '--operator-confirm',
      '--plan',
      HASH,
      '--lives',
      LIST,
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`plan: ${HASH}`);
    expect(a.log()).toContain('--apply --operator-confirm');
    expect(a.log().match(/--apply/g)).toHaveLength(1);
    expect(a.sheets()).toEqual({ ag_a_01: 'standard', ag_b_01: 'standard' });
  });

  it('apply with a different hash refuses, says both hashes, and runs no apply', () => {
    const a = setupAdmin();
    const r = a.run([
      'adopt-sheets',
      'apply',
      '--operator-confirm',
      '--plan',
      '000000000000',
      '--lives',
      LIST,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(
      `adopt-sheets-apply: plan changed (expected 000000000000, now ${HASH})`,
    );
    expect(a.log()).not.toContain('--apply');
  });

  it('apply with the hash of a wider list refuses for the restricted list', () => {
    const a = setupAdmin();
    const r = a.run([
      'adopt-sheets',
      'apply',
      '--operator-confirm',
      '--plan',
      HASH_ALL,
      '--lives',
      LIST,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`expected ${HASH_ALL}, now ${HASH}`);
    expect(a.log()).not.toContain('--apply');
  });

  it('apply whose plan run fails stops before the hash and runs no apply', () => {
    const a = setupAdmin();
    const r = a.run(
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH, '--lives', LIST],
      {
        FAKE_FAIL_PLAN: '1',
      },
    );
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('adopt-sheets plan failed');
    expect(a.log()).not.toContain('--apply');
  });

  it('refuses a life id that the shard file does not list, names only that id, and runs no CLI', () => {
    const a = setupAdmin();
    const r = a.run(['adopt-sheets', 'plan', '--lives', 'ag_a_01,ag_z_01']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('life not in the shard file: ag_z_01');
    expect(r.err).not.toContain('ag_a_01');
    expect(r.out).toBe('');
    expect(a.log()).not.toContain('player adopt-sheets');
  });

  it('refuses an apply with an unlisted id before the CLI runs', () => {
    const a = setupAdmin();
    const r = a.run([
      'adopt-sheets',
      'apply',
      '--operator-confirm',
      '--plan',
      HASH,
      '--lives',
      'ag_z_01',
    ]);
    expect(r.code).not.toBe(0);
    expect(a.log()).not.toContain('player adopt-sheets');
  });

  it.each([
    ['no --lives (unrestricted plan)', ['adopt-sheets', 'plan']],
    ['a flag other than --lives', ['adopt-sheets', 'plan', '--yes', LIST]],
    ['an extra argument to plan', ['adopt-sheets', 'plan', '--lives', LIST, '--apply']],
    [
      'no --lives (unrestricted apply)',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH],
    ],
    [
      '--apply in place of --lives',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH, '--apply', LIST],
    ],
    [
      'the list before --plan',
      ['adopt-sheets', 'apply', '--lives', LIST, '--operator-confirm', '--plan', HASH],
    ],
    ['no --operator-confirm', ['adopt-sheets', 'apply', '--yes', '--plan', HASH, '--lives', LIST]],
    [
      '--operator-confirm after --plan',
      ['adopt-sheets', 'apply', '--plan', HASH, '--operator-confirm', '--lives', LIST],
    ],
    ['no --plan', ['adopt-sheets', 'apply', '--operator-confirm', '--yes', HASH, '--lives', LIST]],
    [
      'a hash that is not 12 hex digits',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', 'XYZ', '--lives', LIST],
    ],
    ['no arguments after apply', ['adopt-sheets', 'apply']],
    [
      'an extra argument to apply',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH, '--lives', LIST, '--apply'],
    ],
    ['an uppercase id', ['adopt-sheets', 'plan', '--lives', 'ag_A_01']],
    ['an id with two digits only', ['adopt-sheets', 'plan', '--lives', 'ag_a_1']],
    ['a dash in an id', ['adopt-sheets', 'plan', '--lives', 'ag-a-01']],
    ['a name of 17 letters', ['adopt-sheets', 'plan', '--lives', 'ag_abcdefghijklmnopq_01']],
    ['a space in the list', ['adopt-sheets', 'plan', '--lives', 'ag_a_01 ag_b_01']],
    ['a trailing comma', ['adopt-sheets', 'plan', '--lives', 'ag_a_01,']],
    ['an empty id between commas', ['adopt-sheets', 'plan', '--lives', 'ag_a_01,,ag_b_01']],
    ['an empty list', ['adopt-sheets', 'plan', '--lives', '']],
    ['a duplicate id', ['adopt-sheets', 'plan', '--lives', 'ag_a_01,ag_b_01,ag_a_01']],
    [
      'a duplicate id in apply',
      ['adopt-sheets', 'apply', '--operator-confirm', '--plan', HASH, '--lives', 'ag_a_01,ag_a_01'],
    ],
    ['121 ids', ['adopt-sheets', 'plan', '--lives', TOO_MANY]],
  ])('refuses adopt-sheets with %s before the CLI runs', (_name, args) => {
    const a = setupAdmin();
    const r = a.run(args);
    expect(r.code).not.toBe(0);
    expect(a.log()).toBe('');
  });
});

describe('colo-admin.sh adopt-sheets-plan and adopt-sheets-apply (decision 0133, ADOPT-LIVES)', () => {
  it('plan with a list starts one admin one-shot with the plan argument and the list', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['adopt-sheets-plan', '--lives', LIST]);
    expect(r.code).toBe(0);
    const s = starts(calls(fx));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/ run --rm --no-deps admin adopt-sheets plan --lives ag_a_01,ag_b_01$/);
    expect(s[0]).not.toContain('--apply');
  });

  it('apply with the hash and the same list starts one admin one-shot with both', () => {
    const fx = fixture();
    const r = run(fx, REAL, [
      'adopt-sheets-apply',
      '--operator-confirm',
      '--plan',
      HASH,
      '--lives',
      LIST,
    ]);
    expect(r.code).toBe(0);
    const s = starts(calls(fx));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(
      new RegExp(
        ` run --rm --no-deps admin adopt-sheets apply --operator-confirm --plan ${HASH} --lives ag_a_01,ag_b_01$`,
      ),
    );
  });

  it('a list of exactly 120 ids is accepted', () => {
    const fx = fixture();
    const ids = Array.from({ length: 120 }, (_, i) => `ag_a${i}_01`).join(',');
    const r = run(fx, REAL, ['adopt-sheets-plan', '--lives', ids]);
    expect(r.code).toBe(0);
    expect(starts(calls(fx))).toHaveLength(1);
  });

  it('a dry run of apply prints the command with the list and starts no container', () => {
    const fx = fixture();
    const r = run(fx, {}, [
      'adopt-sheets-apply',
      '--operator-confirm',
      '--plan',
      HASH,
      '--lives',
      LIST,
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run, not run');
    expect(r.out).toContain('--lives ag_a_01,ag_b_01');
    expect(starts(calls(fx))).toEqual([]);
  });

  it.each([
    ['no arguments to plan (unrestricted)', ['adopt-sheets-plan']],
    ['a flag other than --lives to plan', ['adopt-sheets-plan', '--yes', LIST]],
    ['an argument after the list', ['adopt-sheets-plan', '--lives', LIST, '--apply']],
    ['--lives with no list', ['adopt-sheets-plan', '--lives']],
    ['an uppercase id to plan', ['adopt-sheets-plan', '--lives', 'ag_A_01']],
    ['a duplicate to plan', ['adopt-sheets-plan', '--lives', 'ag_a_01,ag_a_01']],
    ['121 ids to plan', ['adopt-sheets-plan', '--lives', TOO_MANY]],
    ['a space in the list to plan', ['adopt-sheets-plan', '--lives', 'ag_a_01 ag_b_01']],
    ['an empty id to plan', ['adopt-sheets-plan', '--lives', 'ag_a_01,']],
    ['a bad id to plan', ['adopt-sheets-plan', '--lives', 'ag_a_1']],
    ['no arguments to apply (unrestricted)', ['adopt-sheets-apply']],
    [
      'no --lives to apply (unrestricted)',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH],
    ],
    ['no --operator-confirm', ['adopt-sheets-apply', '--yes', '--plan', HASH, '--lives', LIST]],
    [
      '--operator-confirm after --plan',
      ['adopt-sheets-apply', '--plan', HASH, '--operator-confirm', '--lives', LIST],
    ],
    ['no --plan', ['adopt-sheets-apply', '--operator-confirm', '--yes', HASH, '--lives', LIST]],
    [
      '--apply in place of --lives',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH, '--apply', LIST],
    ],
    [
      'an extra argument to apply',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH, '--lives', LIST, '--apply'],
    ],
    [
      'a hash with capitals',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', 'ABCDEF012345', '--lives', LIST],
    ],
    [
      'a hash of 11 digits',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH.slice(1), '--lives', LIST],
    ],
    [
      'a duplicate id to apply',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH, '--lives', 'ag_a_01,ag_a_01'],
    ],
    [
      'an empty list to apply',
      ['adopt-sheets-apply', '--operator-confirm', '--plan', HASH, '--lives', ''],
    ],
  ])('refuses %s before any container starts', (_name, args) => {
    const fx = fixture();
    const r = run(fx, REAL, args);
    expect(r.code).not.toBe(0);
    expect(starts(calls(fx))).toEqual([]);
  });
});
