import { describe, expect, it } from 'vitest';
import type { PidRecord } from './rangers.ts';
import {
  gracefulWaitMs,
  type ProcessIdentity,
  type ProcessOps,
  stopRangerProcess,
  verifyProcess,
} from './rangers-process.ts';

const PID = 4242;
const MARKER = 'players/main.ts --player ag-jason-01';
const RECORD: PidRecord = { pid: PID, started: 'start-1', marker: 'stored-marker-is-not-read' };
/** A Body as Windows prints its command line (backslashes), started when the file recorded. */
const BODY: ProcessIdentity = {
  started: 'start-1',
  commandLine:
    'node --max-old-space-size=320 C:\\repo\\golem\\src\\players\\main.ts --player ag-jason-01',
};

/**
 * Fake process calls. The process exits when the named signal arrives ('graceful' or 'force'), or never
 * ('never'). Each call is recorded; sleeps return at once but add to a clock, so the waits can be measured.
 */
function fakeOps(
  identity: ProcessIdentity | null,
  exitsOn: 'graceful' | 'force' | 'never',
  platform: NodeJS.Platform = 'linux',
) {
  const calls: string[] = [];
  let running = true;
  let clock = 0;
  const ops: ProcessOps = {
    platform,
    alive: () => running,
    identity: () => identity,
    graceful(pid) {
      calls.push(`graceful ${pid}`);
      if (exitsOn === 'graceful') running = false;
    },
    force(pid) {
      calls.push(`force ${pid} at ${clock}ms`);
      if (exitsOn === 'force') running = false;
    },
    sleep: async (ms) => {
      clock += ms;
    },
  };
  return { ops, calls };
}

describe('verifyProcess', () => {
  it('owns a process with the recorded start time and the ranger marker on its command line', () => {
    expect(verifyProcess(RECORD, MARKER, fakeOps(BODY, 'never').ops)).toBe('owned');
  });

  it('owns a Body whose entry path has a space: node quotes it, so a quote sits before the marker', () => {
    const quoted = {
      started: 'start-1',
      commandLine:
        'node --max-old-space-size=320 "C:\\my repo\\golem\\src\\players\\main.ts" --player ag-jason-01',
    };
    expect(verifyProcess(RECORD, MARKER, fakeOps(quoted, 'never').ops)).toBe('owned');
  });

  it('does not trust the marker stored in the PID file: the marker is computed for the ranger', () => {
    const blank: PidRecord = { ...RECORD, marker: '' };
    const other = { started: 'start-1', commandLine: 'node other-tool.js' };
    expect(verifyProcess(blank, MARKER, fakeOps(other, 'never').ops)).toBe('mismatch');
  });

  it('reports a mismatch for a process whose command line lacks the marker, with the same start time', () => {
    const reused = { started: 'start-1', commandLine: 'node other-tool.js --port 8080' };
    expect(verifyProcess(RECORD, MARKER, fakeOps(reused, 'never').ops)).toBe('mismatch');
  });

  it('reports a mismatch for another start time, and unverifiable when no identity can be read', () => {
    const { ops } = fakeOps({ ...BODY, started: 'start-2' }, 'never');
    expect(verifyProcess(RECORD, MARKER, ops)).toBe('mismatch');
    expect(verifyProcess(RECORD, MARKER, fakeOps(null, 'never').ops)).toBe('unverifiable');
  });

  it('reports unverifiable for an empty command line, and for a record whose start time is unknown', () => {
    const empty = { started: 'start-1', commandLine: '  ' };
    expect(verifyProcess(RECORD, MARKER, fakeOps(empty, 'never').ops)).toBe('unverifiable');
    const unknown: PidRecord = { ...RECORD, started: 'unknown' };
    expect(verifyProcess(unknown, MARKER, fakeOps(BODY, 'never').ops)).toBe('unverifiable');
  });

  it('reports dead for a process that is gone', () => {
    const { ops } = fakeOps(BODY, 'never');
    ops.alive = () => false;
    expect(verifyProcess(RECORD, MARKER, ops)).toBe('dead');
  });
});

describe('stopRangerProcess', () => {
  it('reports a process that is already gone, and signals nothing', async () => {
    const { ops, calls } = fakeOps(BODY, 'never');
    ops.alive = () => false;
    expect(await stopRangerProcess(RECORD, MARKER, ops)).toEqual({ kind: 'not-running' });
    expect(calls).toEqual([]);
  });

  it('reports a mismatch for a reused PID: it is not killed', async () => {
    const reused = { started: 'start-1', commandLine: 'node other-tool.js' };
    const { ops, calls } = fakeOps(reused, 'graceful');
    const result = await stopRangerProcess(RECORD, MARKER, ops);
    expect(result.kind).toBe('mismatch');
    expect(result.kind === 'mismatch' && result.reason).toContain('not killed');
    expect(calls).toEqual([]);
  });

  it('reports a mismatch for a process whose start time differs from the file', async () => {
    const { ops, calls } = fakeOps({ ...BODY, started: 'start-2' }, 'graceful');
    expect((await stopRangerProcess(RECORD, MARKER, ops)).kind).toBe('mismatch');
    expect(calls).toEqual([]);
  });

  it('reports unverifiable, and signals nothing, when the identity cannot be read', async () => {
    const { ops, calls } = fakeOps(null, 'graceful');
    const result = await stopRangerProcess(RECORD, MARKER, ops);
    expect(result.kind).toBe('unverifiable');
    expect(result.kind === 'unverifiable' && result.reason).toContain('not killed');
    expect(calls).toEqual([]);
  });

  it('stops a Body gracefully, without a forced stop, when it exits within the wait', async () => {
    const { ops, calls } = fakeOps(BODY, 'graceful');
    expect(await stopRangerProcess(RECORD, MARKER, ops)).toEqual({
      kind: 'stopped',
      how: 'graceful',
    });
    expect(calls).toEqual([`graceful ${PID}`]);
  });

  it('escalates to a forced stop when the Body ignores the graceful one', async () => {
    const { ops, calls } = fakeOps(BODY, 'force');
    expect(await stopRangerProcess(RECORD, MARKER, ops)).toEqual({
      kind: 'stopped',
      how: 'forced',
    });
    expect(calls).toEqual([`graceful ${PID}`, `force ${PID} at 8000ms`]);
  });

  it('waits 1 s for a graceful exit on Windows, and 8 s elsewhere, before the forced stop', async () => {
    expect(gracefulWaitMs('win32')).toBe(1_000);
    expect(gracefulWaitMs('linux')).toBe(8_000);
    const windows = fakeOps(BODY, 'force', 'win32');
    await stopRangerProcess(RECORD, MARKER, windows.ops);
    expect(windows.calls).toEqual([`graceful ${PID}`, `force ${PID} at 1000ms`]);
  });

  it('reports a failed stop when the process is still running after the forced stop', async () => {
    const { ops, calls } = fakeOps(BODY, 'never');
    const result = await stopRangerProcess(RECORD, MARKER, ops);
    expect(result).toEqual({
      kind: 'failed',
      reason: `pid ${PID} is still running after a forced stop`,
    });
    expect(calls).toEqual([`graceful ${PID}`, `force ${PID} at 8000ms`]);
  });
});
