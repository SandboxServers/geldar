// colo-admin.sh: the owner-admin verbs (C7-12, C7-14b) and the player-flags verb (C7-14), routed to the admin
// container. Split from colo-admin.test.ts to keep that file under the 700-line cap; the harness is in
// colo-admin-fixture.ts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

// Runs the script with one id read from $GELDAR_TEST_ID inside the shell, not passed on the command line: MSYS sh on
// Windows splits a command-line argument at a newline, so the id must not travel as argv. The script gets the id as one
// argument, the same as a real operator's call.
function runWithEnvId(fx: Fixture, before: string[], id: string, after: string[]) {
  const script = `sh "$0" ${[...before, '"$GELDAR_TEST_ID"', ...after].join(' ')}`;
  const r = spawnSync(SH, ['-c', script, posix(join(DEPLOY, 'colo-admin.sh'))], {
    env: { ...fx.env, ...REAL, GELDAR_TEST_ID: id },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('colo-admin.sh (decision 0133): owner-admin and player-flags', () => {
  // The admin flag (C7-12) and the player flags (C7-14), routed to the admin container. The script checks the arguments
  // before any container starts; the CLI does the idempotency (owner admin set writes no row when the flag already matches).
  describe('owner-admin and player-flags verbs (C7-12, C7-14, C7-14b)', () => {
    it.each([
      ['owner-admin set jason', ['owner-admin', 'set', 'jason']],
      ['owner-admin unset jason', ['owner-admin', 'unset', 'jason']],
      ['owner-admin list', ['owner-admin', 'list']],
      [
        'player-flags with --public-camera on',
        ['player-flags', 'ag-jo-01', '--public-camera', 'on'],
      ],
      [
        'player-flags with a 40-character id (the longest accepted)',
        ['player-flags', `ag-${'a'.repeat(40)}`, '--public-camera', 'on'],
      ],
    ])('runs %s in the admin container with the arguments unchanged', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).toBe(0);
      expect(
        calls(fx).some((c) =>
          c.endsWith(`--profile admin run --rm --no-deps admin ${args.join(' ')}`),
        ),
      ).toBe(true);
      expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
    });

    it.each([
      ['no verb', ['owner-admin'], 'owner-admin takes'],
      ['a bad verb', ['owner-admin', 'grant', 'jason'], 'owner-admin takes'],
      ['set with no owner', ['owner-admin', 'set'], 'owner-admin takes'],
      ['list with an owner', ['owner-admin', 'list', 'jason'], 'owner-admin takes'],
      ['an owner id with a capital', ['owner-admin', 'set', 'Jason'], 'owner id must be'],
      ['an owner id with a leading dash', ['owner-admin', 'set', '-x'], 'owner id must be'],
      ['an owner id of --dry-run', ['owner-admin', 'set', '--dry-run'], 'owner id must be'],
      ['an owner id with a space', ['owner-admin', 'set', 'a b'], 'owner id must be'],
      [
        'an owner id of 64 characters',
        ['owner-admin', 'unset', 'a'.repeat(64)],
        'owner id must be',
      ],
      ['player-flags with no flag', ['player-flags', 'ag-jo-01'], 'player-flags takes'],
      [
        'player-flags with a bad id',
        ['player-flags', 'jo', '--public-camera', 'on'],
        'player-flags takes',
      ],
      [
        'player-flags with a space in the id',
        ['player-flags', 'ag-a b', '--public-camera', 'on'],
        'player-flags takes',
      ],
      [
        'player-flags with a 41-character id (one past the limit)',
        ['player-flags', `ag-${'a'.repeat(41)}`, '--public-camera', 'on'],
        'player-flags takes',
      ],
    ])('refuses %s before any container starts', (_name, args, message) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(message);
      expect(starts(calls(fx))).toEqual([]);
    });

    // The two ids with a newline are passed through the environment (runWithEnvId), so the Windows shell cannot split
    // them. The assertions are the same as the table rows above.
    it('refuses an owner id with a newline before any container starts', () => {
      const fx = fixture();
      const r = runWithEnvId(fx, ['owner-admin', 'set'], 'jason\nevil', []);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('owner id must be');
      expect(starts(calls(fx))).toEqual([]);
    });

    it('refuses a player id with a newline before any container starts', () => {
      const fx = fixture();
      const r = runWithEnvId(fx, ['player-flags'], 'ag-ok\nevil', ['--public-camera', 'on']);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('player-flags takes');
      expect(starts(calls(fx))).toEqual([]);
    });
  });
});
