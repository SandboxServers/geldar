// Tests for the literal sweep (G0-05): the deploy scripts take their project name, state directory, image prefix
// and player-host names from the environment, and their defaults are today's colo values. Each case runs the real
// scripts under `sh` twice: with no GELDAR_* or COLO_CD_* value set (the defaults), and with a second set of values
// (a second environment). No docker, container or network is used; colo-admin runs in dry-run mode.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupFixtures,
  DEPLOY,
  type Fixture,
  fixture,
  posix,
  run,
  SH,
  SPAWN_TEST_TIMEOUT_MS,
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

// The environment the scripts see: the caller's GELDAR_* and COLO_CD_* values removed, then `extra` added.
// On Windows the scripts get only Git for Windows' tools (usr/bin and mingw64/bin), as the colo-admin fixture does.
function scriptEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(GELDAR_|COLO_CD_)/.test(k)) env[k] = v;
  }
  if (SH !== 'sh') {
    delete env.Path;
    env.PATH = [dirname(SH), join(dirname(SH), '..', '..', 'mingw64', 'bin')].join(delimiter);
  }
  return { ...env, ...extra };
}

// Sources the given deploy files in order (each one is passed as an argument, so its $0 is its own path and
// DEPLOY_DIR is right), then prints the named shell variables, one per line.
function sourced(files: string[], vars: string[], extra: Record<string, string>): string[] {
  const sources = files.map((_, i) => `. "$${i}"`).join('; ');
  const prints = vars.map((v) => `printf '%s\\n' "$${v}"`).join('; ');
  const script = `${sources}; ${prints}`;
  const argv = files.map((f) => posix(join(DEPLOY, f)));
  const r = spawnSync(SH, ['-c', script, ...argv], { env: scriptEnv(extra), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split('\n').slice(0, vars.length);
}

// Lines of a deploy script where a colo path is a bare literal: the two paths outside a ${VAR:-default} form.
const COLO_PATH = /\/var\/lib\/geldar-colo|\/mnt\/nvme\/geldar-colo/;
function bareColoPaths(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => COLO_PATH.test(line.replace(/\$\{[A-Za-z_]+:-[^}]*\}/g, '')));
}

// A player-start dry run: colo-admin.sh names the project and the host it would start.
function playerStart(fx: Fixture, shard: string, extra: Record<string, string>) {
  const file = join(fx.dir, shard);
  writeFileSync(file, 'sovereign: { players: [{ player_id: ag-clara-01, name: clara }] }\n');
  return run(fx, { DEPLOY_DRY_RUN: '1', GELDAR_COLO_SHARD: posix(file), ...extra }, [
    'player-start',
    'ag-clara-01',
  ]);
}

describe('deploy scripts take names from the environment', () => {
  it('common.sh: the defaults are the colo project and state directory', () => {
    expect(sourced(['common.sh'], ['PROJECT', 'STATE_DIR'], {})).toEqual([
      'geldar-colo',
      '/var/lib/geldar-colo',
    ]);
  });

  it('common.sh: a second environment names its own project and state directory', () => {
    const extra = { GELDAR_PROJECT: 'geldar-e2', GELDAR_STATE_DIR: '/srv/geldar-e2/state' };
    expect(sourced(['common.sh'], ['PROJECT', 'STATE_DIR'], extra)).toEqual([
      'geldar-e2',
      '/srv/geldar-e2/state',
    ]);
  });

  it('colo-cd-verify.sh: the image prefix is the GHCR org by default, and overridable', () => {
    expect(sourced(['colo-cd-verify.sh'], ['COLO_CD_IMAGE_PREFIX'], {})).toEqual([
      'ghcr.io/sandboxservers',
    ]);
    expect(
      sourced(['colo-cd-verify.sh'], ['COLO_CD_IMAGE_PREFIX'], {
        COLO_CD_IMAGE_PREFIX: 'ghcr.io/second-org',
      }),
    ).toEqual(['ghcr.io/second-org']);
  });

  it('colo-cd-players.sh: the player host is named after the project, by default and for a second project', () => {
    // host_name is a function of colo-cd-players.sh; the cd run sources common.sh first, the plan run may not.
    const hostName = (files: string[], extra: Record<string, string>) => {
      const argv = files.map((f) => posix(join(DEPLOY, f)));
      const script = `${files.map((_, i) => `. "$${i}"`).join('; ')}; host_name ag-clara-01`;
      const r = spawnSync(SH, ['-c', script, ...argv], { env: scriptEnv(extra), encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    expect(hostName(['common.sh', 'colo-cd-players.sh'], {})).toBe(
      'geldar-colo-players-host-ag-clara-01',
    );
    expect(hostName(['common.sh', 'colo-cd-players.sh'], { GELDAR_PROJECT: 'geldar-e2' })).toBe(
      'geldar-e2-players-host-ag-clara-01',
    );
    expect(hostName(['colo-cd-players.sh'], { GELDAR_PROJECT: 'geldar-e2' })).toBe(
      'geldar-e2-players-host-ag-clara-01',
    );
  });

  it('colo-admin.sh player-start (dry run): the default names the colo project and host', () => {
    const fx = fixture();
    const r = playerStart(fx, 'shard-default.yaml', {});
    expect(r.code).toBe(0);
    expect(r.out).toContain('-p geldar-colo ');
    expect(r.out).toContain('--name geldar-colo-players-host-ag-clara-01');
  });

  it('colo-admin.sh player-start (dry run): a second environment names its own project and host only', () => {
    const fx = fixture();
    const r = playerStart(fx, 'shard-e2.yaml', { GELDAR_PROJECT: 'geldar-e2' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('-p geldar-e2 ');
    expect(r.out).toContain('--name geldar-e2-players-host-ag-clara-01');
    expect(r.out).not.toMatch(/-p geldar-colo |geldar-colo-players-host/);
  });
});

describe('no new fixed colo path in the deploy scripts', () => {
  it('every colo path in deploy/*.sh is a VAR default form, never a bare literal', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DEPLOY).filter((n) => n.endsWith('.sh'))) {
      for (const line of bareColoPaths(readFileSync(join(DEPLOY, f), 'utf8')))
        offenders.push(`${f}: ${line.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the check refuses a bare colo path (it fails on a new literal)', () => {
    expect(bareColoPaths('STATE=/var/lib/geldar-colo\n')).toHaveLength(1);
    expect(bareColoPaths(`STATE=\${GELDAR_STATE_DIR:-/var/lib/geldar-colo}\n`)).toEqual([]);
    expect(bareColoPaths(`ROOT=\${GELDAR_COLO_ROOT:-/mnt/nvme/geldar-colo/src}\n`)).toEqual([]);
    expect(bareColoPaths('ROOT=/mnt/nvme/geldar-colo/src\n')).toHaveLength(1);
  });
});
