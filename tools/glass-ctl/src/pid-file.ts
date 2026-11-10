/**
 * The PID file of the Glass server, format 2: the PID, the process start time, and the command-line marker that
 * names the Glass process. A copy of the format players-cli uses (tools/players-cli/src/rangers.ts), kept here so this
 * tool does not import another package.
 */

export interface PidRecord {
  pid: number;
  started: string;
  marker: string;
}

export const PID_FORMAT = 2;

/** The start time a PID file holds when the platform could not report the process's start (never a real time). */
export const UNKNOWN_START = 'unknown';

/**
 * What the process check says of a PID file's process: `dead` (no such process); `owned` (the Glass process);
 * `mismatch` (readable, and another process); `unverifiable` (alive, and its identity cannot be read).
 */
export type Verdict = 'owned' | 'dead' | 'mismatch' | 'unverifiable';

export function formatPidFile(record: PidRecord): string {
  return `${JSON.stringify({ format: PID_FORMAT, ...record })}\n`;
}

/** A current PID file, or an old one: an old file is never trusted to kill. */
export type PidFile = { kind: 'current'; record: PidRecord } | { kind: 'old' };

export function parsePidFile(text: string): PidFile {
  try {
    const row = JSON.parse(text) as Record<string, unknown>;
    if (
      row.format === PID_FORMAT &&
      typeof row.pid === 'number' &&
      Number.isInteger(row.pid) &&
      row.pid > 0 &&
      typeof row.started === 'string' &&
      row.started !== '' &&
      typeof row.marker === 'string'
    ) {
      return {
        kind: 'current',
        record: { pid: row.pid, started: row.started, marker: row.marker },
      };
    }
  } catch {
    // Not JSON: an old, bare PID file (or anything else).
  }
  return { kind: 'old' };
}
