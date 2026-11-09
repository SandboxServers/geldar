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
  it('has the defaults: all scenarios, 20,10,5 TPS, 5 runs', () => {
    const o = parseCli([], clean);
    expect(o).toMatchObject({ scenario: 'all', tps: [20, 10, 5], runs: 5, maxMinutes: null });
    expect(o.record).toBe(false);
  });

  it('strips a leading lone --', () => {
    expect(parseCli(['--', '--scenario', 'goto-smoke'], clean).scenario).toBe('goto-smoke');
  });

  it('takes repeated --tps, removes duplicates, runs them descending', () => {
    expect(parseCli(['--tps', '5', '--tps', '20', '--tps', '5'], clean).tps).toEqual([20, 5]);
  });

  it('accepts a note with spaces', () => {
    expect(parseCli(['--note', 'a b'], clean).note).toBe('a b');
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

  it('refuses --record on a dirty tree unless --allow-dirty', () => {
    // `all` has no visible scenarios yet in P0-10a, so a named hidden one is not usable here:
    // the dirty check must still apply before anything else is recorded.
    expect(() => parseCli(['--record'], () => true)).toThrow(/dirty/);
    expect(() => parseCli(['--record', '--allow-dirty'], () => true)).not.toThrow();
  });
});

describe('gateLine', () => {
  it('passes when every 20 TPS cell passed all runs', () => {
    expect(gateLine([cellOf({}), cellOf({ tps: 5, passed: 0 })])).toBe('GATE: PASS');
  });

  it('fails and names the scenario for a failing 20 TPS cell', () => {
    expect(gateLine([cellOf({ scenario: 'food', passed: 1 }), cellOf({ scenario: 'bed' })])).toBe(
      'GATE: FAIL (food)',
    );
  });

  it('is n/a without a 20 TPS cell', () => {
    expect(gateLine([cellOf({ tps: 5 })])).toMatch(/n\/a/);
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
