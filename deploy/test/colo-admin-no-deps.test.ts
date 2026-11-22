// Tests for the one-shot admin runs of deploy/colo-admin.sh (incident admin-no-deps). A `compose run` of the admin service
// converges its depends_on (postgres) unless it is given --no-deps, so every one-shot run must carry --no-deps, and a real
// run refuses while the project's postgres container is not running. The fake docker of colo-admin-fixture.ts answers the
// postgres query (FAKE_POSTGRES_RUN, default running; empty means not running). No real docker is used.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calls,
  cleanupFixtures,
  DEPLOY,
  fixture,
  posix,
  REAL,
  run,
  SPAWN_TEST_TIMEOUT_MS,
  setMode,
  starts,
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

const SCRIPT = join(DEPLOY, 'colo-admin.sh');
const NO_DEPS_RUN = 'run --rm --no-deps admin';
const NOT_RUNNING = { ...REAL, FAKE_POSTGRES_RUN: '' };

describe('colo-admin.sh one-shot runs use --no-deps (incident admin-no-deps)', () => {
  it('has no admin one-shot run without --no-deps (grep-style over the script)', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    expect(text).not.toMatch(/run --rm (?!--no-deps )admin/);
    expect(text.match(/run --rm --no-deps admin/g)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });

  it.each([
    [['migrate']],
    [['owner-set-cap', 'jason', '20']],
    [['roster-add', 'Picard', '--owner', 'steve']],
    [['roster-list']],
    [['player-flags', 'ag-clara-01', '--public-camera', 'on']],
  ])('the dry run of %j prints the one-shot with --no-deps and starts nothing', (args) => {
    const fx = fixture();
    const r = run(fx, {}, args);
    expect(r.code).toBe(0);
    expect(r.out).toContain(NO_DEPS_RUN);
    expect(starts(calls(fx))).toEqual([]);
  });

  it('a real migrate starts only the one-shot, with --no-deps, and no up, stop or rm', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['migrate']);
    expect(r.code).toBe(0);
    const log = calls(fx);
    const runs = starts(log);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain(NO_DEPS_RUN);
    expect(log.filter((c) => / up | stop | rm -f /.test(c))).toEqual([]);
  });

  it('checks that the postgres container of the project is running before a real run', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['migrate']);
    expect(r.code).toBe(0);
    expect(
      calls(fx).some(
        (c) =>
          c.startsWith('ps ') &&
          c.includes('label=com.docker.compose.service=postgres') &&
          c.includes('status=running'),
      ),
    ).toBe(true);
  });

  it('refuses a real migrate while postgres is not running, and starts nothing', () => {
    const fx = fixture();
    const r = run(fx, NOT_RUNNING, ['migrate']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres is not running');
    expect(r.out).toContain('This one-shot never starts it. Nothing was changed.');
    expect(starts(calls(fx))).toEqual([]);
    expect(calls(fx).filter((c) => / up | stop | rm -f /.test(c))).toEqual([]);
  });

  it('refuses a real roster-add while postgres is not running, and changes nothing', () => {
    const fx = fixture();
    const r = run(fx, NOT_RUNNING, ['roster-add', 'Picard', '--owner', 'steve']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres is not running');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses token-mint while postgres is not running before it writes the overlay', () => {
    const fx = fixture();
    setMode(fx, 'tokens', '700');
    const r = run(fx, { ...NOT_RUNNING, GELDAR_TOKENS_DIR: posix(fx.tokens) }, [
      'token-mint',
      'alice',
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('postgres is not running');
    expect(starts(calls(fx))).toEqual([]);
    expect(existsSync(join(fx.state, 'admin-tokens.override.yml'))).toBe(false);
  });
});
