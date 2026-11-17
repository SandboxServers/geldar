/**
 * The intent guard of `./geldar.ps1 shard nats-auth phase0` (Assert-NatsAuthIntent). The phase0 table is both the local
 * desktop stack (in a git checkout, --local) and a scratch run (in a clean git archive export, --scratch). A checkout run
 * with no flag, or with --scratch, must write nothing. Each case runs the real generator in a temp copy; a copy with a
 * `.git` entry stands for a checkout, and a copy without one stands for an export. Skips when pwsh is not on PATH.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GENERATOR_TIMEOUT_MS,
  hasPwsh,
  PHASE0_USERS,
  parseEntries,
  type Rendered,
  ROLES,
  renderGenerator,
} from './nats-auth-fixtures.ts';

const rendered: Rendered[] = [];
const render = (...args: Parameters<typeof renderGenerator>): Rendered => {
  const r = renderGenerator(...args);
  rendered.push(r);
  return r;
};

/** The user names in the rendered config, sorted, so the order of the table does not matter. */
const usersOf = (r: Rendered) =>
  parseEntries(r.conf)
    .map((e) => e.user)
    .sort();

const sorted = (xs: readonly string[]) => [...xs].sort();

/** True when the generator created the secrets folder: a refused run must leave it absent. */
const wroteSecrets = (r: Rendered) => existsSync(join(r.dir, 'compose', 'secrets'));

describe.skipIf(!hasPwsh)('geldar.ps1 shard nats-auth phase0: intent guard', () => {
  afterAll(() => {
    for (const r of rendered) rmSync(r.dir, { recursive: true, force: true });
  });

  it(
    '--scratch in a git checkout is refused, names the flags, and writes nothing',
    () => {
      const r = render('phase0', { flags: ['--scratch'], checkout: true });
      expect(r.status, 'a checkout must refuse --scratch').not.toBe(0);
      expect(r.stderr).toContain('--scratch');
      expect(r.stderr).toContain('refused');
      expect(wroteSecrets(r)).toBe(false);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    '--scratch in a clean export (no .git) writes the phase0 table, scratch seed included',
    () => {
      const r = render('phase0', { flags: ['--scratch'] });
      expect(r.status, `exit ${r.status}: ${r.stderr}`).toBe(0);
      expect(usersOf(r)).toEqual(sorted(PHASE0_USERS));
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'no flag in a git checkout is refused, names both flags and the runbook flag, and writes nothing',
    () => {
      const r = render('phase0', { checkout: true });
      expect(r.status, 'a checkout with no flag must refuse').not.toBe(0);
      expect(r.stderr).toContain('--local');
      expect(r.stderr).toContain('--scratch');
      expect(r.stderr).toContain('needs one flag');
      expect(wroteSecrets(r)).toBe(false);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'no flag in a clean export (no .git) behaves like --scratch',
    () => {
      const r = render('phase0');
      expect(r.status, `exit ${r.status}: ${r.stderr}`).toBe(0);
      expect(usersOf(r)).toEqual(sorted(PHASE0_USERS));
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    '--local in a git checkout works as before: the phase0 table is written',
    () => {
      const r = render('phase0', { flags: ['--local'], checkout: true });
      expect(r.status, `exit ${r.status}: ${r.stderr}`).toBe(0);
      expect(usersOf(r)).toEqual(sorted(PHASE0_USERS));
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'both --local and --scratch are refused and write nothing',
    () => {
      const r = render('phase0', { flags: ['--local', '--scratch'], checkout: true });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('two different intents');
      expect(wroteSecrets(r)).toBe(false);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'colo is not guarded: in a checkout with no flag it writes the eleven roles, no seed',
    () => {
      const r = render('colo', { checkout: true });
      expect(r.status, `exit ${r.status}: ${r.stderr}`).toBe(0);
      expect(usersOf(r)).toEqual(sorted(ROLES));
    },
    GENERATOR_TIMEOUT_MS,
  );
});
