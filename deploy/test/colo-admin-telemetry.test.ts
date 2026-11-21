// player-start passes GELDAR_TELEMETRY_URL to the players-host container by a bare `-e NAME` (decision 0342 neighbourhood,
// #840): docker compose copies the value from the calling shell, so it never reaches the command line, the logs or the
// dry-run text. The fake docker from colo-admin-fixture.ts records each compose call; the sentinel is a dummy URL.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calls,
  cleanupFixtures,
  type Fixture,
  fixture,
  REAL,
  run,
  SPAWN_TEST_TIMEOUT_MS,
  starts,
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

const TELEMETRY_SENTINEL = 'http://dummy-telemetry-sentinel.invalid:4318';
const SHARD_TEXT =
  'sovereign:\n  players:\n    - { player_id: ag-clara-01, life_id: ag_clara_01, name: Clara }\n';

function shardEnv(fx: Fixture) {
  const f = join(fx.dir, 'shard.yaml');
  writeFileSync(f, SHARD_TEXT);
  return { ...REAL, GELDAR_COLO_SHARD: f.replace(/\\/g, '/') };
}

// The argument list of the one container start, split into words.
function startWords(fx: Fixture): string[] {
  const s = starts(calls(fx));
  expect(s).toHaveLength(1);
  return s[0].split(' ');
}

describe('player-start telemetry pass-through (bare -e)', () => {
  it('passes GELDAR_TELEMETRY_URL as a bare name when it is set, and never its value', () => {
    const fx = fixture();
    const r = run(fx, { ...shardEnv(fx), GELDAR_TELEMETRY_URL: TELEMETRY_SENTINEL }, [
      'player-start',
      'ag-clara-01',
    ]);
    expect(r.code).toBe(0);
    const words = startWords(fx);
    const i = words.indexOf('GELDAR_TELEMETRY_URL');
    expect(i).toBeGreaterThan(0);
    expect(words[i - 1]).toBe('-e');
    expect(words.indexOf('players-host')).toBeGreaterThan(i);
    expect(words.some((w) => w.startsWith('GELDAR_TELEMETRY_URL='))).toBe(false);
    expect(calls(fx).join('\n')).not.toContain(TELEMETRY_SENTINEL);
    expect(r.out).not.toContain(TELEMETRY_SENTINEL);
  });

  it('adds no GELDAR_TELEMETRY_URL argument when the variable is unset', () => {
    const fx = fixture();
    // The fixture copies the runner's environment: a value set in the shell must not leak into this test.
    delete fx.env.GELDAR_TELEMETRY_URL;
    const r = run(fx, shardEnv(fx), ['player-start', 'ag-clara-01']);
    expect(r.code).toBe(0);
    expect(startWords(fx)).not.toContain('GELDAR_TELEMETRY_URL');
    expect(calls(fx).join('\n')).not.toContain('GELDAR_TELEMETRY_URL');
  });

  it('adds no GELDAR_TELEMETRY_URL argument when the variable is set to an empty string', () => {
    const fx = fixture();
    const r = run(fx, { ...shardEnv(fx), GELDAR_TELEMETRY_URL: '' }, [
      'player-start',
      'ag-clara-01',
    ]);
    expect(r.code).toBe(0);
    expect(startWords(fx)).not.toContain('GELDAR_TELEMETRY_URL');
    expect(calls(fx).join('\n')).not.toContain('GELDAR_TELEMETRY_URL');
  });

  it('keeps the existing start line and the restart policy step when the variable is set', () => {
    const fx = fixture();
    const host = 'geldar-colo-players-host-ag-clara-01';
    run(fx, { ...shardEnv(fx), GELDAR_TELEMETRY_URL: TELEMETRY_SENTINEL }, [
      'player-start',
      'ag-clara-01',
    ]);
    const log = calls(fx);
    expect(starts(log)[0]).toContain(
      `run -d --no-deps --name ${host} -e GELDAR_PLAYER_ID=ag-clara-01 -e GELDAR_TELEMETRY_URL players-host --player ag-clara-01`,
    );
    expect(log).toContain(`update --restart unless-stopped ${host}`);
  });

  it('dry run prints the bare name only, never the value', () => {
    const fx = fixture();
    const r = run(
      fx,
      { ...shardEnv(fx), DEPLOY_DRY_RUN: '1', GELDAR_TELEMETRY_URL: TELEMETRY_SENTINEL },
      ['player-start', 'ag-clara-01'],
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run, not run');
    expect(r.out).toContain('-e GELDAR_TELEMETRY_URL');
    expect(r.out).not.toContain(TELEMETRY_SENTINEL);
    expect(starts(calls(fx))).toEqual([]);
  });
});
