// Tests for deploy/colo-admin.sh (decision 0133). The script runs under `sh` with a fake `docker` and a fake `stat` on
// PATH, as the colo deploy tests do (colo-deploy.test.ts). The fake docker records each call, copies any compose
// overlay it is given to <log>.overlay, and answers only `config`. The fake stat answers the POSIX mode of a file
// from a fixture. No real docker, container, node or network is used. The token file is a sentinel fixture: the
// tests check that its value never reaches stdout or stderr.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calls,
  cleanupFixtures,
  DEPLOY,
  type Fixture,
  fixture,
  mintReal,
  PROJECT_FILTER,
  posix,
  REAL,
  release,
  run,
  SENTINEL,
  SPAWN_TEST_TIMEOUT_MS,
  setMode,
  starts,
} from './colo-admin-fixture';

vi.setConfig({ testTimeout: SPAWN_TEST_TIMEOUT_MS });

afterEach(cleanupFixtures);

describe('colo-admin.sh (decision 0133)', () => {
  it('refuses an unknown subcommand before any docker call', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['drop-tables']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("unknown subcommand 'drop-tables'");
    expect(calls(fx)).toEqual([]);
  });

  it('refuses a missing subcommand', () => {
    const fx = fixture();
    const r = run(fx, REAL, []);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('unknown subcommand');
    expect(calls(fx)).toEqual([]);
  });

  it('refuses token-mint when GELDAR_TOKENS_DIR is unset, and starts no container', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('token-mint needs GELDAR_TOKENS_DIR');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a GELDAR_TOKENS_DIR that is not a directory', () => {
    const fx = fixture();
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(join(fx.dir, 'missing')) }, [
      'token-mint',
      'alice',
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('is not a directory');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a tokens directory with loose permissions (0755), and starts no container', () => {
    const fx = fixture();
    setMode(fx, 'tokens', '755');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(fx.tokens) }, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('has mode 755; it must be 0700');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a tokens directory inside the repo checkout', () => {
    const fx = fixture();
    const inside = join(fx.dir, 'repo', 'tokens');
    mkdirSync(inside);
    setMode(fx, 'tokens', '700');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(inside) }, ['token-mint', 'alice']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('inside the repo checkout');
    expect(starts(calls(fx))).toEqual([]);
  });

  it.each([
    ['/etc/alice.token', 'must be under /run/tokens'],
    ['/run/tokens/../alice.token', "must not contain '..'"],
    ['/run/tokens/sub/alice.token', 'name one file'],
  ])('refuses --out %s', (out, message) => {
    const fx = fixture();
    setMode(fx, 'tokens', '700');
    const r = run(fx, { ...REAL, GELDAR_TOKENS_DIR: posix(fx.tokens) }, [
      'token-mint',
      'alice',
      '--out',
      out,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(message);
    expect(starts(calls(fx))).toEqual([]);
  });

  it('refuses a minted token file that is not mode 0600, and never shows its value', () => {
    const fx = fixture();
    const r = mintReal(fx, '644');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('has mode 644; it must be 0600');
    expect(r.out).not.toContain(SENTINEL);
  });

  it('mints into the mounted tokens directory and prints only the path and byte length', () => {
    const fx = fixture();
    const r = mintReal(fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('alice.token');
    expect(r.out).toContain(`(${SENTINEL.length + 1} bytes)`);
    expect(r.out).not.toContain(SENTINEL);
    expect(
      calls(fx).some((c) =>
        c.endsWith('run --rm admin token-mint alice --out /run/tokens/alice.token'),
      ),
    ).toBe(true);
    const overlay = readFileSync(`${fx.callsLog}.overlay`, 'utf8');
    expect(overlay).toContain('target: /run/tokens');
    expect(overlay).toMatch(/source: ".*tokens"/);
    expect(existsSync(join(fx.state, 'admin-tokens.override.yml'))).toBe(false);
  });

  it('names the geldar-colo project in every docker call, and never runs down -v', () => {
    const fx = fixture();
    expect(mintReal(fx).code).toBe(0);
    const log = calls(fx);
    expect(log.length).toBeGreaterThan(0);
    expect(
      log.every(
        (c) =>
          PROJECT_FILTER.test(c) ||
          /^(compose version|info( --format \{\{\.DockerRootDir\}\})?)$/.test(c),
      ),
    ).toBe(true);
    expect(log.some((c) => /\bdown\b|--volumes/.test(c))).toBe(false);
    const text = readFileSync(join(DEPLOY, 'colo-admin.sh'), 'utf8');
    expect(text).not.toMatch(/down -v|--volumes|volume rm|system prune/);
  });

  it('dry run prints the plan and starts no container', () => {
    const fx = fixture();
    setMode(fx, 'tokens', '700');
    const r = run(fx, { GELDAR_TOKENS_DIR: posix(fx.tokens) }, ['token-mint', 'alice']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry-run, not run');
    const log = calls(fx);
    expect(log.some((c) => c.includes('config --quiet'))).toBe(true);
    expect(starts(log)).toEqual([]);
  });

  it.each([
    ['migrate', ['migrate', '--dry-run']],
    ['owner-add', ['owner-add', 'ag-jo-01', '--cap', '20']],
    ['owner-set-cap', ['owner-set-cap', 'jason', '20']],
    ['token-revoke', ['token-revoke', 'tk_1']],
    ['players-status', ['players-status']],
  ])('runs %s in the admin container without mounting the tokens directory', (_name, args) => {
    const fx = fixture();
    const r = run(fx, REAL, args);
    expect(r.code).toBe(0);
    expect(
      calls(fx).some((c) => c.endsWith(`--profile admin run --rm admin ${args.join(' ')}`)),
    ).toBe(true);
    expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
  });

  it('refuses when the release manifest has no GELDAR_ADMIN_IMAGE', () => {
    const fx = fixture();
    writeFileSync(fx.releaseFile, release(false));
    const r = run(fx, REAL, ['players-status']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no GELDAR_ADMIN_IMAGE');
    expect(starts(calls(fx))).toEqual([]);
  });

  it('runs player-add in the admin container, and does not exit on the host path first', () => {
    const fx = fixture();
    const r = run(fx, REAL, ['player-add', 'ag-clara-01']);
    expect(r.code).toBe(0);
    expect(
      calls(fx).some((c) => c.endsWith('--profile admin run --rm admin player-add ag-clara-01')),
    ).toBe(true);
    expect(starts(calls(fx))).toHaveLength(1);
  });

  it('refuses player-add when the release manifest has no GELDAR_ADMIN_IMAGE', () => {
    const fx = fixture();
    writeFileSync(fx.releaseFile, release(false));
    const r = run(fx, REAL, ['player-add', 'ag-clara-01']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no GELDAR_ADMIN_IMAGE');
    expect(starts(calls(fx))).toEqual([]);
  });

  // The owner cap (decision 0052; set-cap takes 0 to 50 in the CLI, decision 0133 exposes it). The script checks the
  // owner id and N before any container starts, so a bad value never reaches Docker.
  describe('owner-set-cap verb (decisions 0052, 0133)', () => {
    it('runs owner-set-cap as mcp-tokens owner set-cap, id and N passed as separate arguments', () => {
      const fx = fixture();
      const r = run(fx, REAL, ['owner-set-cap', 'jason', '20']);
      expect(r.code).toBe(0);
      expect(
        calls(fx).some((c) => c.endsWith('--profile admin run --rm admin owner-set-cap jason 20')),
      ).toBe(true);
      expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
    });

    it.each([
      ['0', '0'],
      ['50', '50'],
    ])('accepts the cap %s at the edge of 0 to 50', (_name, n) => {
      const fx = fixture();
      const r = run(fx, REAL, ['owner-set-cap', 'jason', n]);
      expect(r.code).toBe(0);
      expect(calls(fx).some((c) => c.endsWith(`admin owner-set-cap jason ${n}`))).toBe(true);
    });

    it.each([
      ['no N', ['owner-set-cap', 'jason'], 'owner-set-cap takes <owner id> <N>'],
      ['no arguments', ['owner-set-cap'], 'owner-set-cap takes <owner id> <N>'],
      [
        'a third argument',
        ['owner-set-cap', 'jason', '20', 'x'],
        'owner-set-cap takes <owner id> <N>',
      ],
      [
        'a non-numeric N',
        ['owner-set-cap', 'jason', 'twenty'],
        'N must be a whole number from 0 to 50',
      ],
      ['a fraction', ['owner-set-cap', 'jason', '2.5'], 'N must be a whole number from 0 to 50'],
      ['a negative N', ['owner-set-cap', 'jason', '-1'], 'N must be a whole number from 0 to 50'],
      ['N above 50', ['owner-set-cap', 'jason', '51'], 'N must be a whole number from 0 to 50'],
      [
        'N with a leading zero',
        ['owner-set-cap', 'jason', '020'],
        'N must be a whole number from 0 to 50',
      ],
      ['an owner id with a capital', ['owner-set-cap', 'Jason', '20'], 'owner id must be'],
      ['an owner id with a space', ['owner-set-cap', 'jason x', '20'], 'owner id must be'],
      ['an empty owner id', ['owner-set-cap', '', '20'], 'owner id must be'],
    ])('refuses owner-set-cap with %s before any container starts', (_name, args, message) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(message);
      expect(starts(calls(fx))).toEqual([]);
    });
  });

  // The roster (decision 0108): roster-add and roster-list map to `mcp-tokens roster add|list` in the admin container.
  describe('roster verbs (decision 0108)', () => {
    it('runs roster-add as mcp-tokens roster add, name and owner passed as separate arguments', () => {
      const fx = fixture();
      const r = run(fx, REAL, ['roster-add', 'Picard', '--owner', 'steve']);
      expect(r.code).toBe(0);
      expect(
        calls(fx).some((c) =>
          c.endsWith('--profile admin run --rm admin roster add Picard --owner steve'),
        ),
      ).toBe(true);
      expect(existsSync(`${fx.callsLog}.overlay`)).toBe(false);
    });

    it('runs roster-list as mcp-tokens roster list, with an owner filter only when given', () => {
      const fx = fixture();
      expect(run(fx, REAL, ['roster-list']).code).toBe(0);
      expect(run(fx, REAL, ['roster-list', '--owner', 'steve']).code).toBe(0);
      const log = calls(fx);
      expect(log.some((c) => c.endsWith('--profile admin run --rm admin roster list'))).toBe(true);
      expect(
        log.some((c) => c.endsWith('--profile admin run --rm admin roster list --owner steve')),
      ).toBe(true);
    });

    it('dry run of roster-add prints the roster command and starts no container', () => {
      const fx = fixture();
      const r = run(fx, { DEPLOY_DRY_RUN: '1' }, ['roster-add', 'Picard', '--owner', 'steve']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('dry-run, not run');
      expect(r.out).toContain('admin roster add Picard --owner steve');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['a player id with a hyphen', ['roster-add', 'ag-picard-01', '--owner', 'steve']],
      ['a name with a semicolon', ['roster-add', 'Pic;ard', '--owner', 'steve']],
      ['a command substitution', ['roster-add', '$(id)', '--owner', 'steve']],
      ['a name of 17 letters', ['roster-add', 'a'.repeat(17), '--owner', 'steve']],
      ['an empty name', ['roster-add', '', '--owner', 'steve']],
      ['a path', ['roster-add', '../x', '--owner', 'steve']],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('a roster name is 1 to 16 letters, digits or _');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['an owner with a capital', ['roster-add', 'Picard', '--owner', 'Steve']],
      ['an owner with shell characters', ['roster-add', 'Picard', '--owner', 'st;eve']],
      ['an owner of 64 characters', ['roster-add', 'Picard', '--owner', 'o'.repeat(64)]],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('owner id must be 1 to 63 lower-case letters, digits or dashes');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['no owner', ['roster-add', 'Picard']],
      ['--owner with no value', ['roster-add', 'Picard', '--owner']],
      ['the owner as a positional', ['roster-add', 'Picard', 'steve']],
      ['an extra flag', ['roster-add', 'Picard', '--owner', 'steve', '--max', '4']],
      ['two names', ['roster-add', 'Picard', 'Other', '--owner', 'steve']],
    ])('refuses roster-add with %s before any container runs', (_name, args) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('roster-add takes <name> --owner <owner>');
      expect(starts(calls(fx))).toEqual([]);
    });

    it.each([
      ['an owner with a capital', ['roster-list', '--owner', 'Steve'], 'owner id must be'],
      ['a positional argument', ['roster-list', 'steve'], 'roster-list takes no arguments'],
      ['--owner with no value', ['roster-list', '--owner'], 'roster-list takes no arguments'],
      ['an unknown flag', ['roster-list', '--all'], 'roster-list takes no arguments'],
    ])('refuses roster-list with %s before any container runs', (_name, args, message) => {
      const fx = fixture();
      const r = run(fx, REAL, args);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(message);
      expect(starts(calls(fx))).toEqual([]);
    });
  });

  describe('per-player hosts (C1-10b)', () => {
    const SHARD_TEXT =
      'sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n    - { player_id: ag-clara-01, life_id: ag_clara_01, name: Clara }\n';
    const shardEnv = (fx: Fixture) => {
      const f = join(fx.dir, 'shard.yaml');
      writeFileSync(f, SHARD_TEXT);
      return { ...REAL, GELDAR_COLO_SHARD: posix(f) };
    };
    const HOST = 'geldar-colo-players-host-ag-clara-01';

    it('starts one named host per player with run -d --no-deps, the id in env and in the command', () => {
      const fx = fixture();
      const r = run(fx, shardEnv(fx), ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      const s = starts(log);
      expect(s).toHaveLength(1);
      expect(s[0]).toContain('-p geldar-colo');
      expect(s[0]).toContain('--profile sovereign');
      expect(s[0]).toContain(
        `run -d --no-deps --name ${HOST} -e GELDAR_PLAYER_ID=ag-clara-01 players-host --player ag-clara-01`,
      );
      expect(s[0]).not.toMatch(/--rm/);
      // The restart policy is set on the container after it starts (compose run has no --restart flag).
      expect(log).toContain(`update --restart unless-stopped ${HOST}`);
      expect(log).not.toContain(`update --restart on-failure:5 ${HOST}`);
      expect(log.indexOf(`update --restart unless-stopped ${HOST}`)).toBeGreaterThan(
        log.findIndex((c) => c === s[0]),
      );
    });

    it('lists a stopped host as exited, so the CD can see it', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST }, ['player-list']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('ag-clara-01: exited');
      expect(r.out).not.toContain('ag-clara-01: running');
    });

    it.each(['created', 'dead'])('prints a %s host as its actual state, not as exited', (st) => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST, FAKE_STATUS: st }, ['player-list']);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`ag-clara-01: ${st} (${HOST})`);
      expect(r.out).not.toContain('ag-clara-01: exited');
    });

    it('starts the host and exits 0 when docker update fails; the host is not stopped or removed', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_UPDATE_FAIL: '1' }, [
        'player-start',
        'ag-clara-01',
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('cannot set its restart policy');
      expect(starts(calls(fx))).toHaveLength(1);
      expect(calls(fx).some((c) => c.startsWith('stop ') || c.startsWith('rm '))).toBe(false);
    });

    it('leaves a host that is already running, and starts nothing', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_RUN: HOST }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('already running');
      expect(starts(calls(fx))).toEqual([]);
    });

    it('removes a stopped leftover of the same name (rm -f) before it starts', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      expect(log).toContain(`rm -f ${HOST}`);
      expect(log.indexOf(`rm -f ${HOST}`)).toBeLessThan(
        log.findIndex((c) => c.includes(' run -d ')),
      );
      expect(starts(log)).toHaveLength(1);
    });

    it.each([
      ['an unlisted id', 'ag-nobody-01'],
      ['a bad pattern', 'Ag_Clara'],
      ['an id with an injected flag', 'ag-clara-01 --privileged'],
      ['a too long id', `ag-${'a'.repeat(41)}`],
    ])('refuses %s before any docker call', (_n, id) => {
      const fx = fixture();
      for (const verb of ['player-start', 'player-stop']) {
        const r = run(fx, shardEnv(fx), [verb, id]);
        expect(r.code).not.toBe(0);
      }
      expect(calls(fx)).toEqual([]);
    });

    it('stops only the named project container, and does nothing when it is absent', () => {
      const fx = fixture();
      const none = run(fx, shardEnv(fx), ['player-stop', 'ag-clara-01']);
      expect(none.code).toBe(0);
      expect(calls(fx).some((c) => c.startsWith('stop '))).toBe(false);
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_ALL: HOST }, ['player-stop', 'ag-clara-01']);
      expect(r.code).toBe(0);
      const log = calls(fx);
      expect(log.filter((c) => c.startsWith('stop '))).toEqual([`stop ${HOST}`]);
      expect(log.filter((c) => c.startsWith('ps ')).every((c) => PROJECT_FILTER.test(c))).toBe(
        true,
      );
    });

    it('lists every listed player with its state', () => {
      const fx = fixture();
      const r = run(fx, { ...shardEnv(fx), FAKE_PS_RUN: 'x' }, ['player-list']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('ag-jason-01: running');
      expect(r.out).toContain('ag-clara-01: running');
      const none = run(fx, shardEnv(fx), ['player-list']);
      expect(none.out).toContain('ag-clara-01: not running');
    });

    it('dry run starts and stops nothing, and needs no admin image', () => {
      const fx = fixture();
      writeFileSync(fx.releaseFile, release(false));
      const r = run(fx, { ...shardEnv(fx), DEPLOY_DRY_RUN: '1' }, ['player-start', 'ag-clara-01']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('dry-run, not run');
      expect(starts(calls(fx))).toEqual([]);
    });
  });
});
