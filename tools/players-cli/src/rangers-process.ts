/**
 * Stops one ranger's Body, and only that process. The PID file's process must still be alive, must have the
 * start time the file recorded, and must show the ranger's command-line marker (computed fresh, never read from
 * the file). Then it is stopped gracefully, waited for, and forcibly stopped only if it is still running. The
 * process calls are behind `ProcessOps`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { type PidRecord, UNKNOWN_START, type Verdict } from './rangers.ts';

export interface ProcessIdentity {
  /** The process start time, as the platform reports it (a string the PID file stores and compares). */
  started: string;
  commandLine: string;
}

/** The process calls `down` needs. Tests pass fakes; `productionOps` makes the real ones. */
export interface ProcessOps {
  /** The platform the calls run on, as `process.platform` names it. */
  platform: NodeJS.Platform;
  alive(pid: number): boolean;
  identity(pid: number): ProcessIdentity | null;
  /** A stop the process can handle: SIGTERM on POSIX; on Windows a close request, which a console Body ignores. */
  graceful(pid: number): void;
  /** A hard stop: SIGKILL, or `taskkill /T /F` (the process tree) on Windows. */
  force(pid: number): void;
  sleep(ms: number): Promise<void>;
}

export const GRACEFUL_WAIT_MS = 8_000;
/** Windows: `taskkill` without /F does not reach a console Body, so waiting longer only delays the forced stop. */
export const WINDOWS_GRACEFUL_WAIT_MS = 1_000;
export const FORCE_WAIT_MS = 5_000;
const POLL_MS = 250;

/** How long a stop waits for a graceful exit on this platform. */
export function gracefulWaitMs(platform: NodeJS.Platform): number {
  return platform === 'win32' ? WINDOWS_GRACEFUL_WAIT_MS : GRACEFUL_WAIT_MS;
}

export type StopResult =
  | { kind: 'not-running' }
  | { kind: 'stopped'; how: 'graceful' | 'forced' }
  /** The identity is readable and says the PID is another process: the PID file is stale, nothing is signalled. */
  | { kind: 'mismatch'; reason: string }
  /** The identity cannot be read: the PID may be the Body, so nothing is signalled and the PID file stays. */
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'failed'; reason: string };

/** Quotes are stripped because node quotes an entry path that has a space, which splits the marker. */
function commandLineHas(commandLine: string, marker: string): boolean {
  // Windows prints backslashes; the marker uses forward slashes.
  return commandLine.replace(/\\/g, '/').replace(/"/g, '').includes(marker);
}

/**
 * The verdict on a PID file's process: `dead` (no such process), `unverifiable` (alive, but its start time or
 * command line cannot be read, or the file has no start time), `mismatch` (readable, and not the ranger's Body:
 * another start time, or no marker), or `owned` (the same start time and the marker on the command line).
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

/** Stops the recorded process if it is the ranger's Body. A reused PID is never signalled. */
export async function stopRangerProcess(
  record: PidRecord,
  marker: string,
  ops: ProcessOps,
): Promise<StopResult> {
  const verdict = verifyProcess(record, marker, ops);
  if (verdict === 'dead') return { kind: 'not-running' };
  if (verdict === 'mismatch') {
    return {
      kind: 'mismatch',
      reason: `pid ${record.pid} is not this ranger's Body (reused by another process); not killed`,
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
  if (await waitForExit(record.pid, ops, gracefulWaitMs(ops.platform)))
    return { kind: 'stopped', how: 'graceful' };
  try {
    ops.force(record.pid);
  } catch {
    // As above: a failed kill is only a failure if the process is still alive.
  }
  if (await waitForExit(record.pid, ops, FORCE_WAIT_MS)) return { kind: 'stopped', how: 'forced' };
  return { kind: 'failed', reason: `pid ${record.pid} is still running after a forced stop` };
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
export function productionOps(): ProcessOps {
  const windows = process.platform === 'win32';
  return {
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
        return windows ? windowsIdentity(pid) : linuxIdentity(pid);
      } catch {
        return null;
      }
    },
    graceful(pid) {
      if (windows) execFileSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    },
    force(pid) {
      if (windows) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    },
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
}
