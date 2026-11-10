import { describe, expect, it } from 'vitest';
import type { PidRecord } from './rangers.ts';
import {
  ownsProcess,
  type ProcessIdentity,
  type ProcessOps,
  stopRangerProcess,
} from './rangers-process.ts';

const PID = 4242;
const MARKER = 'players/main.ts --player ag-jason-01';
const RECORD: PidRecord = { pid: PID, started: 'start-1', marker: MARKER };
/** A Body as Windows prints its command line (backslashes), started when the file recorded. */
const BODY: ProcessIdentity = {
  started: 'start-1',
  commandLine:
    'node --max-old-space-size=320 C:\\repo\\golem\\src\\players\\main.ts --player ag-jason-01',
};

/**
 * Fake process calls. The process exits when the named signal arrives ('graceful' or 'force'), or never
 * ('never'). Each call is recorded; sleeps return at once, so the wait loop runs its polls without waiting.
 */
function fakeOps(identity: ProcessIdentity | null, exitsOn: 'graceful' | 'force' | 'never') {
  const calls: string[] = [];
  let running = true;
  const ops: ProcessOps = {
    alive: () => running,
    identity: () => identity,
    graceful(pid) {
      calls.push(`graceful ${pid}`);
      if (exitsOn === 'graceful') running = false;
    },
    force(pid) {
      calls.push(`force ${pid}`);
      if (exitsOn === 'force') running = false;
    },
    sleep: async () => {},
  };
  return { ops, calls };
}

describe('ownsProcess', () => {
  it('owns a process with the recorded start time and the ranger marker on its command line', () => {
    expect(ownsProcess(RECORD, BODY)).toBe(true);
  });

  it('does not own a process whose command line lacks the marker, even with the same start time', () => {
    const reused = { started: 'start-1', commandLine: 'node other-tool.js --port 8080' };
    expect(ownsProcess(RECORD, reused)).toBe(false);
  });

  it('does not own a process with another start time, or none that can be read', () => {
    expect(ownsProcess(RECORD, { ...BODY, started: 'start-2' })).toBe(false);
    expect(ownsProcess(RECORD, null)).toBe(false);
  });
});

describe('stopRangerProcess', () => {
  it('reports a process that is already gone, and signals nothing', async () => {
    const { ops, calls } = fakeOps(BODY, 'never');
    ops.alive = () => false;
    expect(await stopRangerProcess(RECORD, ops)).toEqual({ kind: 'not-running' });
    expect(calls).toEqual([]);
  });

  it('refuses a reused PID: the command line does not match, so it is not killed and the refusal is reported', async () => {
    const reused = { started: 'start-1', commandLine: 'node other-tool.js' };
    const { ops, calls } = fakeOps(reused, 'graceful');
    const result = await stopRangerProcess(RECORD, ops);
    expect(result.kind).toBe('refused');
    expect(result.kind === 'refused' && result.reason).toContain('not killed');
    expect(calls).toEqual([]);
  });

  it('refuses a process whose start time differs from the file', async () => {
    const { ops, calls } = fakeOps({ ...BODY, started: 'start-2' }, 'graceful');
    expect((await stopRangerProcess(RECORD, ops)).kind).toBe('refused');
    expect(calls).toEqual([]);
  });

  it('stops a Body gracefully, without a forced stop, when it exits within the wait', async () => {
    const { ops, calls } = fakeOps(BODY, 'graceful');
    expect(await stopRangerProcess(RECORD, ops)).toEqual({ kind: 'stopped', how: 'graceful' });
    expect(calls).toEqual([`graceful ${PID}`]);
  });

  it('escalates to a forced stop when the Body ignores the graceful one', async () => {
    const { ops, calls } = fakeOps(BODY, 'force');
    expect(await stopRangerProcess(RECORD, ops)).toEqual({ kind: 'stopped', how: 'forced' });
    expect(calls).toEqual([`graceful ${PID}`, `force ${PID}`]);
  });

  it('reports a failed stop when the process is still running after the forced stop', async () => {
    const { ops, calls } = fakeOps(BODY, 'never');
    const result = await stopRangerProcess(RECORD, ops);
    expect(result).toEqual({
      kind: 'failed',
      reason: `pid ${PID} is still running after a forced stop`,
    });
    expect(calls).toEqual([`graceful ${PID}`, `force ${PID}`]);
  });
});
