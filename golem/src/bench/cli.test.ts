import { describe, expect, it } from 'vitest';
import type { GolemConfig } from '../config.ts';
import { type CliDeps, gateLine, main, parseCli, UsageError } from './cli.ts';
import type { Written } from './results.ts';
import type { CellResult } from './types.ts';

const clean = (): boolean => false;

function cellOf(partial: Partial<CellResult>): CellResult {
  return {
    scenario: 'goto-smoke',
    tps: 20,
    runs: 2,
    passed: 2,
    actions: [],
    actionStats: {},
    runWallMs: [],
    failures: [],
    perRun: [],
    notes: [],
    ...partial,
  };
}

describe('parseCli', () => {
  it('has the defaults: 20,10,5 TPS, 5 runs', () => {
    const o = parseCli(['--scenario', 'goto-smoke'], clean);
    expect(o).toMatchObject({
      scenario: 'goto-smoke',
      tps: [20, 10, 5],
      runs: 5,
      maxMinutes: null,
    });
    expect(o.record).toBe(false);
  });

  it('strips a leading lone --', () => {
    expect(parseCli(['--', '--scenario', 'goto-smoke'], clean).scenario).toBe('goto-smoke');
  });

  it('takes repeated --tps, removes duplicates, runs them descending', () => {
    expect(
      parseCli(['--scenario', 'goto-smoke', '--tps', '5', '--tps', '20', '--tps', '5'], clean).tps,
    ).toEqual([20, 5]);
  });

  it('accepts a note with spaces', () => {
    expect(parseCli(['--scenario', 'goto-smoke', '--note', 'a b'], clean).note).toBe('a b');
  });

  it.each([
    [['--scenario', 'nope']],
    [['--tps', '0']],
    [['--tps', '21']],
    [['--tps', 'x']],
    [['--runs', '0']],
    [['--runs', '101']],
    [['--max-minutes', '0']],
    [['--note', 'bad|char']],
    [['--bogus']],
    [['stray']],
  ])('rejects %j with a usage error', (args) => {
    expect(() => parseCli(args, clean)).toThrow(UsageError);
  });

  it('refuses --record with a hidden scenario', () => {
    expect(() =>
      parseCli(['--record', '--scenario', 'goto-smoke', '--allow-dirty'], clean),
    ).toThrow(/hidden/);
  });

  it('refuses the default all while no scenario is visible, except for --list and --restore', () => {
    expect(() => parseCli([], clean)).toThrow(/no visible scenario/);
    expect(() => parseCli(['--list'], clean)).not.toThrow();
    expect(() => parseCli(['--restore'], clean)).not.toThrow();
  });

  it('refuses --record on a dirty tree unless --allow-dirty', () => {
    // `all` has no visible scenarios yet in P0-10a, so a named hidden one is not usable here:
    // the dirty check must still apply before anything else is recorded.
    expect(() => parseCli(['--record'], () => true)).toThrow(/dirty/);
    // Past the dirty check the empty default list is the next refusal.
    expect(() => parseCli(['--record', '--allow-dirty'], () => true)).toThrow(
      /no visible scenario/,
    );
  });
});

describe('gateLine', () => {
  it('says truncated for a 20 TPS cell with fewer runs than asked, FAIL still wins', () => {
    expect(gateLine([cellOf({ runs: 1, passed: 1 })], 2)).toBe('GATE: INCOMPLETE (truncated)');
    expect(gateLine([cellOf({ runs: 0, passed: 0 })], 2)).toBe('GATE: INCOMPLETE (truncated)');
    expect(gateLine([cellOf({ runs: 1, passed: 0 })], 2)).toBe('GATE: FAIL (goto-smoke)');
    expect(gateLine([cellOf({ runs: 2, passed: 2 })], 2)).toBe('GATE: PASS');
  });

  it('passes when every 20 TPS cell passed all runs', () => {
    expect(gateLine([cellOf({}), cellOf({ tps: 5, passed: 0 })])).toBe('GATE: PASS');
  });

  it('fails and names the scenario for a failing 20 TPS cell', () => {
    expect(gateLine([cellOf({ scenario: 'food', passed: 1 }), cellOf({ scenario: 'bed' })])).toBe(
      'GATE: FAIL (food)',
    );
  });

  it('is incomplete when a requested scenario has no 20 TPS cell', () => {
    const cells = [cellOf({ scenario: 'food', runs: 2, passed: 2 })];
    expect(gateLine(cells, 2, ['food', 'bed'], true)).toBe('GATE: INCOMPLETE (truncated)');
    expect(gateLine([], 2, ['food'], true)).toBe('GATE: INCOMPLETE (truncated)');
    const both = [...cells, cellOf({ scenario: 'bed', runs: 2, passed: 2 })];
    expect(gateLine(both, 2, ['food', 'bed'], true)).toBe('GATE: PASS');
  });

  it('is n/a without a 20 TPS cell', () => {
    expect(gateLine([cellOf({ tps: 5 })])).toMatch(/n\/a/);
  });

  it('is n/a, not PASS, when no scenario ran at all', () => {
    expect(gateLine([], 5, [], true)).toBe('GATE: n/a (no 20 TPS cell ran)');
  });
});

/** A control over a scripted server, recording every command in `log`. */
function harness(opts: { list?: string; tick?: string } = {}) {
  const log: string[] = [];
  const ctl = {
    async whitelistAdd(name: string) {
      log.push(`whitelist add ${name}`);
    },
    async command(cmd: string) {
      log.push(cmd);
      return cmd === 'list' ? (opts.list ?? 'There are 0 of a max of 400 players online: ') : '';
    },
    async tickQuery() {
      return opts.tick ?? 'Target tick rate: 20.0 per second.';
    },
    async tickRate(n: number) {
      log.push(`tick rate ${n}`);
    },
    async gamerule(name: string, value?: boolean) {
      log.push(`gamerule ${name} ${value}`);
    },
    async timeSet() {
      return '';
    },
    async version() {
      return 'Paper version 26.1.2-58';
    },
  };
  const out: string[] = [];
  const err: string[] = [];
  const written: Written = { file: 'f.json', recordedFile: null, summary: [] };
  const deps: CliDeps = {
    config: {} as GolemConfig,
    connectRcon: async () => ({ ctl: ctl as never, close: async () => undefined }),
    createManager: () =>
      ({
        state: 'online',
        bot: null,
        on: () => undefined,
        off: () => undefined,
        async start() {
          log.push('connect bot');
          return {} as never;
        },
        async stop() {
          log.push('stop bot');
        },
      }) as never,
    cell: async (scenario, tps) => cellOf({ scenario: scenario.name, tps, passed: 0 }),
    meta: (async () => ({ date: 'd', stamp: 's', commit: 'c' })) as never,
    write: async () => written,
    installRestore: () => () => undefined,
    dirty: clean,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    sleep: async () => undefined,
  };
  return { log, out, err, deps };
}

describe('main', () => {
  it('exits 2 with a usage line for an unknown scenario', async () => {
    const h = harness();
    expect(await main(['--scenario', 'nope'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toMatch(/usage:/);
    expect(h.log).toEqual([]);
  });

  it('prints the resolved options on --dry-run without touching RCON', async () => {
    const h = harness();
    expect(
      await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1', '--dry-run'], h.deps),
    ).toBe(0);
    const line = JSON.parse(h.out[0] as string);
    expect(line).toMatchObject({ scenario: 'goto-smoke', tps: [20], runs: 1 });
    expect(h.log).toEqual([]);
  });

  it('whitelists GolemBench before it connects the bot, then prints the gate and exits 0', async () => {
    const h = harness();
    const code = await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '2'], h.deps);
    expect(code).toBe(0);
    expect(h.log.indexOf('whitelist add GolemBench')).toBeGreaterThanOrEqual(0);
    expect(h.log.indexOf('whitelist add GolemBench')).toBeLessThan(h.log.indexOf('connect bot'));
    expect(h.out).toContain('GATE: FAIL (goto-smoke)');
    // restoreWorld ran in the final finally, after the bot stopped.
    expect(h.log.lastIndexOf('stop bot')).toBeLessThan(h.log.lastIndexOf('tick rate 20'));
  });

  it.each([
    [true, 0],
    [false, 1],
  ])(
    'with the restore handler stopping=%s it closes the control %i time(s)',
    async (stopping, closes) => {
      const h = harness();
      let closed = 0;
      const connect = h.deps.connectRcon as NonNullable<CliDeps['connectRcon']>;
      h.deps.connectRcon = async (cfg) => {
        const rcon = await connect(cfg);
        return {
          ctl: rcon.ctl,
          close: async () => {
            closed++;
          },
        };
      };
      h.deps.installRestore = () => Object.assign(() => undefined, { isStopping: () => stopping });
      await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], h.deps);
      // The handler restores and closes when it is stopping; main must not race it.
      expect(closed).toBe(closes);
      expect(h.log.includes('tick rate 20')).toBe(!stopping);
      expect(h.err.join('\n')).not.toMatch(/restoreWorld failed/);
    },
  );

  it('exits 2 for --scenario all while no scenario is visible', async () => {
    const h = harness();
    expect(await main(['--tps', '20'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toMatch(/no visible scenario/);
    expect(h.log).toEqual([]);
  });

  it('does not close the control when a signal arrives during the final restore', async () => {
    const h = harness();
    let stopping = false;
    let closed = 0;
    const connect = h.deps.connectRcon as NonNullable<CliDeps['connectRcon']>;
    h.deps.connectRcon = async (cfg) => {
      const rcon = await connect(cfg);
      const tickRate = rcon.ctl.tickRate.bind(rcon.ctl);
      // The signal lands while restoreWorld is awaiting the server.
      rcon.ctl.tickRate = async (n: number) => {
        stopping = true;
        return tickRate(n);
      };
      return {
        ctl: rcon.ctl,
        close: async () => {
          closed++;
        },
      };
    };
    h.deps.installRestore = () => Object.assign(() => undefined, { isStopping: () => stopping });
    await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], h.deps);
    expect(stopping).toBe(true);
    expect(closed).toBe(0);
  });

  it('plays every cell in arena slot 5', async () => {
    const h = harness();
    const slots: number[] = [];
    h.deps.cell = async (scenario, tps, _runs, cellDeps) => {
      slots.push(cellDeps.slot);
      return cellOf({ scenario: scenario.name, tps, passed: 0 });
    };
    await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], h.deps);
    expect(slots).toEqual([5]);
  });

  it('kicks a leftover GolemBench and refuses other players', async () => {
    const mine = harness({ list: 'There are 1 of a max of 400 players online: GolemBench' });
    let polls = 0;
    mine.deps.sleep = async () => undefined;
    const original = mine.deps.connectRcon;
    mine.deps.connectRcon = async (cfg) => {
      const rcon = await (original as NonNullable<typeof original>)(cfg);
      const command = rcon.ctl.command.bind(rcon.ctl);
      rcon.ctl.command = async (cmd: string) => {
        const reply = await command(cmd);
        if (cmd === 'list' && ++polls > 1) return 'There are 0 of a max of 400 players online: ';
        return reply;
      };
      return rcon;
    };
    expect(await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], mine.deps)).toBe(
      0,
    );
    expect(mine.log).toContain('kick GolemBench');

    const other = harness({ list: 'There are 1 of a max of 400 players online: Someone' });
    expect(await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], other.deps)).toBe(
      1,
    );
    expect(other.err.join('\n')).toContain('Someone');
    expect(other.log).not.toContain('connect bot');
  });

  it('refuses when the list counts players but names none', async () => {
    const h = harness({ list: 'There are 2 of a max of 400 players online: ' });
    expect(await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toMatch(/other players are online/);
    expect(h.log).not.toContain('connect bot');
    expect(h.log).not.toContain('kick GolemBench');
  });

  it('stops at --max-minutes: truncated, no cell is started late, the gate says truncated', async () => {
    const h = harness();
    let clock = 0;
    h.deps.now = () => clock;
    let written: Parameters<NonNullable<CliDeps['write']>>[0] | undefined;
    h.deps.write = async (input) => {
      written = input;
      return { file: 'f.json', recordedFile: null, summary: [] };
    };
    h.deps.cell = async (scenario, tps, runs) => {
      clock += 61_000;
      return cellOf({ scenario: scenario.name, tps, runs, passed: runs });
    };
    await main(
      ['--scenario', 'goto-smoke', '--tps', '20,10', '--runs', '2', '--max-minutes', '1'],
      h.deps,
    );
    expect(written?.truncated).toBe(true);
    expect(written?.cells.map((c) => c.tps)).toEqual([20]);
    expect(h.out.some((l) => l.startsWith('truncated: true'))).toBe(true);
    expect(h.out.at(-1)).toBe('GATE: PASS');
  });

  it('marks a 20 TPS cell cut to fewer runs, or to none, as truncated and not as a pass', async () => {
    for (const played of [1, 0]) {
      const h = harness();
      h.deps.cell = async (scenario, tps) =>
        cellOf({ scenario: scenario.name, tps, runs: played, passed: played });
      await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '2'], h.deps);
      expect(h.out.some((l) => l.startsWith('truncated: true'))).toBe(true);
      expect(h.out.at(-1)).toBe('GATE: INCOMPLETE (truncated)');
    }
  });

  it('exits 1 when the player list cannot be read', async () => {
    const h = harness({ list: 'garbled' });
    expect(await main(['--scenario', 'goto-smoke', '--tps', '20'], h.deps)).toBe(1);
  });

  it('exits 1 when RCON is not reachable', async () => {
    const h = harness();
    h.deps.connectRcon = async () => {
      throw new Error('shard not up: run ./geldar.ps1 shard up phase0');
    };
    expect(await main(['--scenario', 'goto-smoke', '--tps', '20'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('shard not up');
  });

  it('restores 20 TPS and warns when the server starts at another rate', async () => {
    const h = harness({ tick: 'Target tick rate: 5.0 per second.' });
    await main(['--scenario', 'goto-smoke', '--tps', '20', '--runs', '1'], h.deps);
    expect(h.err.join('\n')).toMatch(/restoring 20/);
    expect(h.log).toContain('tick rate 20');
  });

  it('--restore restores the world and exits 0 without a bot', async () => {
    const h = harness();
    expect(await main(['--restore'], h.deps)).toBe(0);
    expect(h.log).toContain('tick rate 20');
    expect(h.log).not.toContain('connect bot');
  });
});
