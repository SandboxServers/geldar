import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatPidFile, type Presence, type Ranger } from './rangers.ts';
import { eachRanger, parseOptions, probeStart, runRangersCli, USAGE } from './rangers-cli.ts';
import type { LogFs } from './rangers-logs.ts';
import type { ProcessIdentity, ProcessOps } from './rangers-process.ts';

const SHARD = `
sovereign:
  players:
    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }
`;

const MARKER = 'players/main.ts --player ag-jason-01';
const BODY: ProcessIdentity = {
  started: 'start-1',
  commandLine: 'node C:\\repo\\golem\\src\\players\\main.ts --player ag-jason-01',
};

/** Fake process calls: the process is alive until the named signal arrives, or never exits. */
function fakeOps(identity: ProcessIdentity | null, exitsOn: 'graceful' | 'never') {
  const calls: string[] = [];
  let running = true;
  const ops: ProcessOps = {
    platform: 'linux',
    alive: () => running,
    identity: () => identity,
    graceful: (pid) => {
      calls.push(`graceful ${pid}`);
      if (exitsOn === 'graceful') running = false;
    },
    force: (pid) => {
      calls.push(`force ${pid}`);
    },
    sleep: async () => {},
  };
  return { ops, calls };
}

let runDir = '';
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), 'players-cli-'));
});
afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

const pidPath = () => join(runDir, 'ag-jason-01.pid');

describe('parseOptions', () => {
  it('accepts no option, or --player with an id', () => {
    expect(parseOptions([])).toEqual({ playerId: undefined });
    expect(parseOptions(['--player', 'ag-jason-01'])).toEqual({ playerId: 'ag-jason-01' });
  });

  it('refuses any other flag or a missing id', () => {
    expect(parseOptions(['--player'])).toBeNull();
    expect(parseOptions(['--player', ''])).toBeNull();
    expect(parseOptions(['--follow'])).toBeNull();
  });
});

describe('runRangersCli', () => {
  const noPresence = { readPresence: async () => new Map() };

  it('answers a usage error with exit 2 for an unknown verb', async () => {
    const result = await runRangersCli(['restart'], SHARD, noPresence);
    expect(result.code).toBe(2);
    expect(result.lines).toEqual([USAGE]);
  });

  it('refuses an id the shard config does not name, with exit 2 and no process started', async () => {
    const result = await runRangersCli(['up', '--player', 'ag-nobody-01'], SHARD, noPresence);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toContain("no sovereign player 'ag-nobody-01'");
  });

  it('prints the presence of each life in status, read from the presence source', async () => {
    const readPresence = async (lifeIds: readonly string[]) =>
      new Map<string, Presence>(
        lifeIds.map((id) => [
          id,
          { kind: 'record', state: 'hibernating', desiredBody: 'down', at: '2026-11-10T12:00:00Z' },
        ]),
      );
    const result = await runRangersCli(['status'], SHARD, { readPresence });
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('presence: hibernating, desired body down');
  });

  it('prints presence unknown and keeps going when the presence source cannot be read', async () => {
    const result = await runRangersCli(['status'], SHARD, { readPresence: async () => new Map() });
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('presence: unknown');
  });
});

describe('down', () => {
  it('removes the PID file only after the Body has exited', async () => {
    writeFileSync(pidPath(), formatPidFile({ pid: 4242, started: 'start-1', marker: MARKER }));
    const { ops, calls } = fakeOps(BODY, 'graceful');
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(['ag-jason-01 stopped (graceful, pid 4242)']);
    expect(calls).toEqual(['graceful 4242']);
    expect(existsSync(pidPath())).toBe(false);
  });

  it('keeps the PID file and exits 1 when the Body survives the stop', async () => {
    writeFileSync(pidPath(), formatPidFile({ pid: 4242, started: 'start-1', marker: MARKER }));
    const { ops } = fakeOps(BODY, 'never');
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toContain('not stopped: pid 4242 is still running');
    expect(existsSync(pidPath())).toBe(true);
  });

  it('never signals a reused PID: it reports the refusal and clears the stale file', async () => {
    writeFileSync(pidPath(), formatPidFile({ pid: 4242, started: 'start-1', marker: MARKER }));
    const reused: ProcessIdentity = { started: 'start-1', commandLine: 'node other-tool.js' };
    const { ops, calls } = fakeOps(reused, 'graceful');
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(calls).toEqual([]);
    expect(result.lines[0]).toContain('not killed');
    expect(existsSync(pidPath())).toBe(false);
  });

  it('treats an old bare-PID file as stale: a live PID is never killed, and the file is kept', async () => {
    writeFileSync(pidPath(), '4242\n');
    const { ops, calls } = fakeOps(BODY, 'graceful');
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(calls).toEqual([]);
    expect(result.code).toBe(1);
    expect(existsSync(pidPath())).toBe(true);
    expect(readFileSync(pidPath(), 'utf8')).toBe('4242\n');
  });

  it('removes an old bare-PID file whose PID is dead, and signals nothing', async () => {
    writeFileSync(pidPath(), '4242\n');
    const { ops, calls } = fakeOps(null, 'never');
    ops.alive = () => false;
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(result).toEqual({ code: 0, lines: ['ag-jason-01 down (old pid file removed)'] });
    expect(calls).toEqual([]);
    expect(existsSync(pidPath())).toBe(false);
  });
});

describe('unverifiable processes', () => {
  const RECORD_TEXT = () => formatPidFile({ pid: 4242, started: 'start-1', marker: MARKER });

  it('down keeps the PID file, exits 1 and signals nothing when the identity cannot be read', async () => {
    writeFileSync(pidPath(), RECORD_TEXT());
    const { ops, calls } = fakeOps(null, 'graceful');
    const result = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toContain('not stopped: pid 4242 cannot be verified');
    expect(calls).toEqual([]);
    expect(existsSync(pidPath())).toBe(true);
  });

  it('status shows unknown, not online, when the identity cannot be read', async () => {
    writeFileSync(pidPath(), RECORD_TEXT());
    const { ops } = fakeOps(null, 'never');
    const result = await runRangersCli(['status'], SHARD, {
      ops,
      runDir,
      readPresence: async () => new Map(),
    });
    expect(result.lines[0]).toContain('ag-jason-01 unknown pid 4242 (cannot verify pid 4242)');
  });

  it('status shows a reused PID as stale, and up would start over it', async () => {
    writeFileSync(pidPath(), RECORD_TEXT());
    const reused: ProcessIdentity = { started: 'start-1', commandLine: 'node other-tool.js' };
    const { ops } = fakeOps(reused, 'never');
    const result = await runRangersCli(['status'], SHARD, {
      ops,
      runDir,
      readPresence: async () => new Map(),
    });
    expect(result.lines[0]).toContain('ag-jason-01 stale pid 4242');
  });

  it('up refuses a ranger whose process cannot be verified, and starts no second Body', async () => {
    writeFileSync(pidPath(), RECORD_TEXT());
    const { ops } = fakeOps(null, 'never');
    const result = await runRangersCli(['up'], SHARD, { ops, runDir });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toContain('not started: pid 4242 cannot be verified');
    expect(existsSync(pidPath())).toBe(true);
  });

  it('a file whose start time is unknown shows unknown, and down refuses it', async () => {
    writeFileSync(pidPath(), formatPidFile({ pid: 4242, started: 'unknown', marker: MARKER }));
    const { ops, calls } = fakeOps(BODY, 'graceful');
    const status = await runRangersCli(['status'], SHARD, {
      ops,
      runDir,
      readPresence: async () => new Map(),
    });
    expect(status.lines[0]).toContain('unknown pid 4242 (start time unreadable)');
    const down = await runRangersCli(['down'], SHARD, { ops, runDir });
    expect(down.code).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('probeStart', () => {
  /** An identity probe that returns each queued answer in turn, and counts its sleeps. */
  function probeOps(answers: Array<ProcessIdentity | null>) {
    let sleeps = 0;
    const queue = [...answers];
    const ops = {
      platform: 'linux',
      alive: () => true,
      identity: () => queue.shift() ?? null,
      graceful: () => {},
      force: () => {},
      sleep: async () => {
        sleeps += 1;
      },
    } satisfies ProcessOps;
    return { ops, sleeps: () => sleeps };
  }

  it('returns the start time at once when the first probe reads it, without waiting', async () => {
    const { ops, sleeps } = probeOps([BODY]);
    expect(await probeStart(4242, ops)).toBe('start-1');
    expect(sleeps()).toBe(0);
  });

  it('retries once after a short wait when the first probe fails', async () => {
    const { ops, sleeps } = probeOps([null, BODY]);
    expect(await probeStart(4242, ops)).toBe('start-1');
    expect(sleeps()).toBe(1);
  });

  it('stores unknown, never an empty start time, when both probes fail', async () => {
    const { ops, sleeps } = probeOps([null, null]);
    expect(await probeStart(4242, ops)).toBe('unknown');
    expect(sleeps()).toBe(1);
  });
});

describe('eachRanger', () => {
  const RANGERS: Ranger[] = [
    { playerId: 'ag-jason-01', lifeId: 'ag_jason_01', name: 'Jason' },
    { playerId: 'ag-test-01', lifeId: 'ag_test_01', name: 'Test' },
  ];

  it('runs every ranger when one throws, and exits 1 with the failure named', async () => {
    const seen: string[] = [];
    const result = await eachRanger(RANGERS, async (ranger) => {
      seen.push(ranger.playerId);
      if (ranger.playerId === 'ag-jason-01') throw new Error('boom');
      return { line: `${ranger.playerId} ok`, failed: false };
    });
    expect(seen).toEqual(['ag-jason-01', 'ag-test-01']);
    expect(result.code).toBe(1);
    expect(result.lines).toEqual(['ag-jason-01 failed: boom', 'ag-test-01 ok', '1 of 2 failed']);
  });

  it('exits 0 when no ranger fails', async () => {
    const result = await eachRanger(RANGERS, async (ranger) => ({
      line: `${ranger.playerId} ok`,
      failed: false,
    }));
    expect(result).toEqual({ code: 0, lines: ['ag-jason-01 ok', 'ag-test-01 ok'] });
  });
});

describe('logs', () => {
  it('reads only the last 64 KB of a 10 MB log, and prints the last 200 lines', async () => {
    const text = `${Array.from({ length: 200_000 }, (_, n) => `log line ${n} ${'x'.repeat(40)}`).join('\n')}\n`;
    let bytesRead = 0;
    const logFs: LogFs = {
      exists: () => true,
      size: () => text.length,
      read: (_path, start, length) => {
        const part = text.slice(start, start + length);
        bytesRead += part.length;
        return part;
      },
      rename: () => {
        throw new Error('logs must not rename a log');
      },
    };
    const result = await runRangersCli(['logs'], SHARD, { runDir, logFs });
    expect(result.code).toBe(0);
    expect(result.lines).toHaveLength(200);
    expect(result.lines.at(-1)).toBe(`log line 199999 ${'x'.repeat(40)}`);
    expect(bytesRead).toBeLessThanOrEqual(64 * 1024);
  });
});
