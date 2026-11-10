/**
 * The process calls of `glass up|down|status`: spawn a detached process, read its identity, verify a PID file's process,
 * and stop it. Every call is behind `ProcessOps`, so the tests pass fakes. The ownership rules follow
 * tools/players-cli/src/rangers-process.ts.
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { type PidRecord, UNKNOWN_START, type Verdict } from './pid-file.ts';

export interface ProcessIdentity {
  /** The process start time, as the platform reports it (a string the PID file stores and compares). */
  started: string;
  commandLine: string;
}

export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Both stdout and stderr of the child are appended to this file. */
  logPath: string;
}

/** The process calls the Glass commands need. Tests pass fakes; `productionOps` makes the real ones. */
export interface ProcessOps {
  /** The platform the calls run on, as `process.platform` names it. */
  platform: NodeJS.Platform;
  alive(pid: number): boolean;
  identity(pid: number): ProcessIdentity | null;
  /** A stop the process can handle: SIGTERM on POSIX; on Windows a close request. */
  graceful(pid: number): void;
  /** A hard stop: SIGKILL, or `taskkill /T /F` (the process tree) on Windows. */
  force(pid: number): void;
  /** Starts a detached child and returns its PID, or undefined when no process was made. */
  spawnDetached(request: SpawnRequest): number | undefined;
  sleep(ms: number): Promise<void>;
}

export const GRACEFUL_WAIT_MS = 8_000;
/** Windows: `taskkill` without /F does not reach a process without a console, so waiting longer only delays the forced stop. */
export const WINDOWS_GRACEFUL_WAIT_MS = 1_000;
export const FORCE_WAIT_MS = 5_000;
const POLL_MS = 250;
const START_PROBE_RETRY_MS = 300;

export type StopResult =
  | { kind: 'not-running' }
  | { kind: 'stopped'; how: 'graceful' | 'forced' }
  /** The identity is readable and says the PID is another process: nothing is signalled. */
  | { kind: 'mismatch'; reason: string }
  /** The identity cannot be read: nothing is signalled and the PID file stays. */
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'failed'; reason: string };

/** How long a stop waits for a graceful exit on this platform. */
export function gracefulWaitMs(platform: NodeJS.Platform): number {
  return platform === 'win32' ? WINDOWS_GRACEFUL_WAIT_MS : GRACEFUL_WAIT_MS;
}

/** Quotes are stripped because node quotes an entry path that has a space, which splits the marker. */
export function commandLineHas(commandLine: string, marker: string): boolean {
  // Windows prints backslashes; the marker uses forward slashes.
  return commandLine.replace(/\\/g, '/').replace(/"/g, '').includes(marker);
}

/**
 * The verdict on a PID file's process: `dead` (no such process), `unverifiable` (alive, but its start time or
 * command line cannot be read, or the file has no start time), `mismatch` (readable, and not Glass: another start
 * time, or no marker), or `owned` (the same start time and the marker on the command line).
 */
export function verifyProcess(record: PidRecord, marker: string, ops: ProcessOps): Verdict {
  if (!ops.alive(record.pid)) return 'dead';
  if (record.started === UNKNOWN_START) return 'unverifiable';
  const identity = ops.identity(record.pid);
  if (identity === null) return 'unverifiable';
  if (identity.started !== record.started) return 'mismatch';
  if (identity.commandLine.trim() === '') return 'unverifiable';
  return commandLineHas(identity.commandLine, marker) ? 'owned' : 'mismatch';
}

async function waitForExit(pid: number, ops: ProcessOps, waitMs: number): Promise<boolean> {
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    if (!ops.alive(pid)) return true;
    await ops.sleep(POLL_MS);
  }
  return !ops.alive(pid);
}

/** Stops the recorded process if it is Glass. A reused PID is never signalled. */
export async function stopProcess(
  record: PidRecord,
  marker: string,
  ops: ProcessOps,
): Promise<StopResult> {
  const verdict = verifyProcess(record, marker, ops);
  if (verdict === 'dead') return { kind: 'not-running' };
  if (verdict === 'mismatch') {
    return {
      kind: 'mismatch',
      reason: `pid ${record.pid} is not Glass (reused by another process); not killed`,
    };
  }
  if (verdict === 'unverifiable') {
    return {
      kind: 'unverifiable',
      reason: `pid ${record.pid} cannot be verified (its start time or command line is unreadable); not killed`,
    };
  }
  try {
    ops.graceful(record.pid);
  } catch {
    // The process may have exited between the check and the signal; the wait decides.
  }
  if (await waitForExit(record.pid, ops, gracefulWaitMs(ops.platform))) {
    return { kind: 'stopped', how: 'graceful' };
  }
  try {
    ops.force(record.pid);
  } catch {
    // As above: a failed kill is only a failure if the process is still alive.
  }
  if (await waitForExit(record.pid, ops, FORCE_WAIT_MS)) return { kind: 'stopped', how: 'forced' };
  return { kind: 'failed', reason: `pid ${record.pid} is still running after a forced stop` };
}

/**
 * The start time of a process just spawned. A probe that fails is retried once after a short wait; if it still fails
 * the start time is `unknown`, which status shows and up and down refuse as unverifiable.
 */
export async function probeStart(pid: number, ops: ProcessOps): Promise<string> {
  const first = ops.identity(pid)?.started;
  if (first) return first;
  await ops.sleep(START_PROBE_RETRY_MS);
  return ops.identity(pid)?.started || UNKNOWN_START;
}

/** Windows: the start time and command line from WMI; null when the process is gone or WMI cannot say. */
function windowsIdentity(pid: number): ProcessIdentity | null {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | ForEach-Object { $_.CreationDate.ToUniversalTime().ToString('o'); $_.CommandLine }`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const [started = '', ...rest] = out.split(/\r?\n/);
  return started.trim() === '' ? null : { started: started.trim(), commandLine: rest.join('\n') };
}

/** Linux: field 22 of /proc/<pid>/stat (the start time in clock ticks) and /proc/<pid>/cmdline. */
function linuxIdentity(pid: number): ProcessIdentity | null {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // The fields after the parenthesised command name start at field 3, so field 22 is index 19.
  const started = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
  return started === undefined ? null : { started, commandLine };
}

/** The real process calls. An identity that cannot be read is null, which `verifyProcess` calls unverifiable. */
export const PRODUCTION_OPS: ProcessOps = {
  platform: process.platform,
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists under another user: alive, but not ours to signal.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  identity(pid) {
    try {
      return process.platform === 'win32' ? windowsIdentity(pid) : linuxIdentity(pid);
    } catch {
      return null;
    }
  },
  graceful(pid) {
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  },
  force(pid) {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else process.kill(pid, 'SIGKILL');
  },
  spawnDetached(request) {
    const out = openSync(request.logPath, 'a');
    try {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        detached: true,
        stdio: ['ignore', out, out],
        windowsHide: true,
        env: request.env,
      });
      // A spawn that fails (no such program) reports through this event; the missing PID is what the caller checks.
      child.on('error', () => {});
      child.unref();
      return child.pid;
    } finally {
      closeSync(out);
    }
  },
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};
