/**
 * Stops one ranger's Body, and only that process. The PID file's process must still be alive, must have the
 * start time the file recorded, and must show the ranger's command-line marker. Then it is stopped gracefully,
 * waited for, and forcibly stopped only if it is still running. The process calls are behind `ProcessOps`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { PidRecord } from './rangers.ts';

export interface ProcessIdentity {
  /** The process start time, as the platform reports it (a string the PID file stores and compares). */
  started: string;
  commandLine: string;
}

/** The process calls `down` needs. Tests pass fakes; `productionOps` makes the real ones. */
export interface ProcessOps {
  alive(pid: number): boolean;
  identity(pid: number): ProcessIdentity | null;
  /** A stop the process can handle: SIGTERM on POSIX; on Windows a close request, which a console Body ignores. */
  graceful(pid: number): void;
  /** A hard stop: SIGKILL, or `taskkill /T /F` (the process tree) on Windows. */
  force(pid: number): void;
  sleep(ms: number): Promise<void>;
}

export const GRACEFUL_WAIT_MS = 8_000;
export const FORCE_WAIT_MS = 5_000;
const POLL_MS = 250;

export type StopResult =
  | { kind: 'not-running' }
  | { kind: 'stopped'; how: 'graceful' | 'forced' }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; reason: string };

/** Whether a live process is the one the PID file recorded: the same start time, and the marker on its command line. */
export function ownsProcess(record: PidRecord, identity: ProcessIdentity | null): boolean {
  if (identity === null || identity.started !== record.started) return false;
  // Windows prints backslashes; the marker uses forward slashes.
  return identity.commandLine.replace(/\\/g, '/').includes(record.marker);
}

async function waitForExit(pid: number, ops: ProcessOps, waitMs: number): Promise<boolean> {
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    if (!ops.alive(pid)) return true;
    await ops.sleep(POLL_MS);
  }
  return !ops.alive(pid);
}

/** Stops the recorded process if it is the ranger's Body. A reused PID is refused, and never signalled. */
export async function stopRangerProcess(record: PidRecord, ops: ProcessOps): Promise<StopResult> {
  if (!ops.alive(record.pid)) return { kind: 'not-running' };
  if (!ownsProcess(record, ops.identity(record.pid))) {
    return {
      kind: 'refused',
      reason: `pid ${record.pid} is not this ranger's Body (reused, or it cannot be verified); not killed`,
    };
  }
  try {
    ops.graceful(record.pid);
  } catch {
    // The process may have exited between the check and the signal; the wait decides.
  }
  if (await waitForExit(record.pid, ops, GRACEFUL_WAIT_MS))
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

/** The real process calls. An identity that cannot be read is null, which `ownsProcess` refuses. */
export function productionOps(): ProcessOps {
  const windows = process.platform === 'win32';
  return {
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
