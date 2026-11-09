import { describe, expect, it } from 'vitest';
import { TestControl } from '../test-control.ts';
import {
  installTpsRestore,
  type ProcessLike,
  parseMspt,
  parseTargetMspt,
  parseTargetRate,
  setTps,
  withTps,
} from './tps.ts';

/** Real replies from the running 26.1.2 server (RCON strips the colour codes). */
const QUERY_20 =
  'The game is running normallyTarget tick rate: 20.0 per second.\nAverage time per tick: 0.2ms (Target: 50.0ms)Percentiles: P50: 0.2ms P95: 0.2ms P99: 0.3ms. Sample: 100';
const QUERY_5 =
  'The game is running normallyTarget tick rate: 5.0 per second.\nAverage time per tick: 0.2ms (Target: 200.0ms)Percentiles: P50: 0.2ms P95: 0.2ms P99: 0.3ms. Sample: 100';
const SET_5 = 'Set the target tick rate to 5.0 per second';

/** A tick control that records `tickRate` calls and answers `tickQuery` with the last rate set. */
function fakeTick(replies: Record<number, string> = { 5: QUERY_5, 20: QUERY_20 }) {
  const rates: number[] = [];
  return {
    rates,
    async tickRate(n: number) {
      rates.push(n);
      return SET_5;
    },
    async tickQuery() {
      return replies[rates.at(-1) ?? 20] ?? QUERY_20;
    },
  };
}

describe('tick reply parsing', () => {
  it('reads the target rate, average and target mspt', () => {
    expect(parseTargetRate(QUERY_5)).toBe(5);
    expect(parseTargetRate(QUERY_20)).toBe(20);
    expect(parseMspt(QUERY_5)).toBe(0.2);
    expect(parseTargetMspt(QUERY_5)).toBe(200);
    expect(parseTargetRate('no rate here')).toBeNull();
    expect(parseMspt('no rate here')).toBeNull();
  });

  it('does not match a rate that only appears as a substring', () => {
    expect(parseTargetRate('Target tick rate: 5.0 per second')).toBeNull();
    expect(parseTargetRate('xTarget tick rate: 5 per second. 20')).toBe(5);
  });
});

describe('setTps', () => {
  it('passes when the reply names the target, 5 equal to 5.0', async () => {
    await expect(setTps(fakeTick(), 5)).resolves.toBeUndefined();
  });

  it('throws when the server still reports 20 TPS and the target is 5', async () => {
    const ctl = fakeTick();
    ctl.tickQuery = async () => QUERY_20;
    await expect(setTps(ctl, 5)).rejects.toThrow(/not 5/);
  });

  it('throws when the reply cannot be parsed', async () => {
    const ctl = fakeTick({ 5: 'something else' });
    await expect(setTps(ctl, 5)).rejects.toThrow(/not 5/);
  });
});

describe('withTps', () => {
  it('restores 20 when fn throws', async () => {
    const ctl = fakeTick();
    await expect(
      withTps(ctl, 5, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(ctl.rates).toEqual([5, 20]);
  });

  it('returns the value of fn and restores 20', async () => {
    const ctl = fakeTick();
    await expect(withTps(ctl, 5, async () => 7)).resolves.toBe(7);
    expect(ctl.rates).toEqual([5, 20]);
  });
});

/** A process stand-in that lets a test fire events. */
function fakeProcess() {
  const handlers = new Map<string, (arg?: unknown) => void>();
  const proc: ProcessLike = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    off(event) {
      handlers.delete(event);
    },
  };
  return { proc, handlers };
}

describe('installTpsRestore', () => {
  const events = [
    'SIGINT',
    'SIGTERM',
    'SIGBREAK',
    'SIGHUP',
    'uncaughtException',
    'unhandledRejection',
  ];

  it.each(events)('%s restores once and a second event does not restore again', async (event) => {
    const commands: string[] = [];
    const ctl = {
      async command(cmd: string) {
        commands.push(cmd);
        return '';
      },
      async gamerule() {
        commands.push('gamerule');
        return '';
      },
      async tickRate(n: number) {
        commands.push(`tick rate ${n}`);
        return '';
      },
    } as unknown as TestControl;
    const { proc, handlers } = fakeProcess();
    const exits: number[] = [];
    const done = new Promise<void>((resolve) => {
      installTpsRestore(ctl, {
        proc,
        exit: (code) => {
          exits.push(code);
          resolve();
        },
        log: () => undefined,
      });
    });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      handlers.get(event)?.(new Error('x'));
      // A second crash event is ignored; a second signal is covered by its own test.
      handlers.get('uncaughtException')?.(new Error('y'));
      await done;
    } finally {
      console.error = quiet;
    }
    // The rate goes back first, then the world rules, then the rate again at the end of restoreWorld.
    expect(commands[0]).toBe('tick rate 20');
    expect(commands.filter((c) => c === 'gamerule').length).toBeGreaterThan(0);
    expect(exits).toEqual([event.startsWith('SIG') ? 130 : 1]);
  });

  it('closes ctl after the first event and exits 130 at once on a second signal', async () => {
    const commands: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctl = {
      async command(cmd: string) {
        commands.push(cmd);
        return '';
      },
      async gamerule() {
        return '';
      },
      async tickRate(n: number) {
        commands.push(`tick rate ${n}`);
        await gate;
        return '';
      },
    } as unknown as TestControl;
    const { proc, handlers } = fakeProcess();
    const exits: number[] = [];
    installTpsRestore(ctl, { proc, exit: (code) => exits.push(code), log: () => undefined });

    // Before any event the runner's ctl works.
    await ctl.command('before');
    handlers.get('SIGINT')?.();
    // The restore is stuck on tick rate 20: the runner's late commands must throw, not interleave.
    expect(() => ctl.command('late')).toThrow(/stopping/);
    expect(exits).toEqual([]);
    handlers.get('SIGINT')?.();
    expect(exits).toEqual([130]);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(commands).not.toContain('late');
    expect(commands.slice(0, 2)).toEqual(['before', 'tick rate 20']);
  });

  it('guards a real TestControl, flags stopping and logs the hint on a second signal', async () => {
    const sent: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctl = new TestControl({
      async command(cmd: string) {
        sent.push(cmd);
        if (cmd.startsWith('tick rate')) await gate;
        return '';
      },
    });
    const { proc, handlers } = fakeProcess();
    const exits: number[] = [];
    const logs: string[] = [];
    const handle = installTpsRestore(ctl, {
      proc,
      exit: (code) => exits.push(code),
      log: (line) => logs.push(line),
    });
    expect(handle.isStopping()).toBe(false);
    await ctl.tickQuery();
    handlers.get('SIGTERM')?.();
    expect(handle.isStopping()).toBe(true);
    // Prototype methods are guarded too: the runner's late command throws, the restore's goes through.
    expect(() => ctl.tickQuery()).toThrow(/stopping/);
    expect(() => ctl.command('late')).toThrow(/stopping/);
    expect(sent).toEqual(['tick query', 'tick rate 20']);
    handlers.get('SIGTERM')?.();
    expect(exits).toEqual([130]);
    expect(logs).toEqual(['server may be left at 20 TPS: run ./geldar.ps1 bench --restore']);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).not.toContain('late');
  });

  it('retries on a fresh connection and prints the hint when all fail', async () => {
    const bad = {
      async gamerule() {
        throw new Error('down');
      },
    } as unknown as TestControl;
    const logs: string[] = [];
    let opened = 0;
    const { proc, handlers } = fakeProcess();
    const done = new Promise<void>((resolve) => {
      installTpsRestore(bad, {
        proc,
        exit: () => resolve(),
        log: (line) => logs.push(line),
        openFresh: async () => {
          opened++;
          throw new Error('no rcon');
        },
      });
    });
    handlers.get('SIGINT')?.();
    await done;
    expect(opened).toBe(3);
    expect(logs[0]).toMatch(/SERVER LEFT AT \d+ TPS: run \.\/geldar\.ps1 bench --restore/);
  });
});
