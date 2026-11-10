/**
 * The side effects of `adam up|down|status|logs`: PID files and logs under `.geldar/adam/`,
 * spawning and stopping the host processes. Loopback only (decision 0050).
 */
import { execFile, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { type ProcRow, procState, SERVICES, type Service, stopOrder } from './procs.ts';

const execFileAsync = promisify(execFile);

/** The repository root: three levels above `tools/adam-cli/src`. */
export const ROOT = resolve(import.meta.dirname, '..', '..', '..');
/** PID files and logs of the run (gitignored). */
export const RUN_DIR = join(ROOT, '.geldar', 'adam');

export const pidFile = (s: Service): string => join(RUN_DIR, `${s.name}.pid`);
export const logFile = (s: Service): string => join(RUN_DIR, `${s.name}.log`);

/** True when a process with this PID exists (a permission error still means it exists). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Each service's state, read from its PID file. */
export function readRows(): ProcRow[] {
  return SERVICES.map((s) => {
    const text = existsSync(pidFile(s)) ? readFileSync(pidFile(s), 'utf8') : null;
    const state = procState(text, isAlive);
    const pid = state === 'running' && text !== null ? Number(text.trim()) : null;
    return { name: s.name, state, pid };
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Starts one service as a detached background Node process running its TypeScript entry point
 * from its package directory; its output goes to its log file. Returns the PID.
 */
export function startService(service: Service, env: Record<string, string>): number {
  mkdirSync(RUN_DIR, { recursive: true });
  const fd = openSync(logFile(service), 'a');
  try {
    const child = spawn(process.execPath, [service.entry], {
      cwd: join(ROOT, service.dir),
      env: { ...process.env, ...env },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    if (child.pid === undefined) throw new Error(`${service.name} did not start`);
    writeFileSync(pidFile(service), `${child.pid}\n`);
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

/** Starts the services in order; after a short wait, returns the names of those already dead. */
export async function startAll(env: Record<string, string>, settleMs = 3_000): Promise<string[]> {
  for (const service of SERVICES) {
    const pid = startService(service, env);
    console.log(`started ${service.name} (pid ${pid}), log ${logFile(service)}`);
  }
  await sleep(settleMs);
  return readRows()
    .filter((r) => r.state !== 'running')
    .map((r) => r.name);
}

/**
 * Stops one service: SIGTERM, then SIGKILL after `graceMs`. On Windows a signal ends the process
 * at once, so the Body resumes from its last checkpoint instead of writing a final one.
 */
export async function stopService(service: Service, graceMs = 15_000): Promise<string> {
  const text = existsSync(pidFile(service)) ? readFileSync(pidFile(service), 'utf8') : null;
  const row = readRows().find((r) => r.name === service.name);
  rmSync(pidFile(service), { force: true });
  if (text === null) return 'not running';
  if (row?.state !== 'running' || row.pid === null) return 'stale PID file removed';
  process.kill(row.pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (isAlive(row.pid) && Date.now() < deadline) await sleep(200);
  if (!isAlive(row.pid)) return 'stopped';
  process.kill(row.pid, 'SIGKILL');
  return 'killed after the grace period';
}

/** Stops every service in reverse start order (the Body last). */
export async function stopAll(): Promise<void> {
  for (const service of stopOrder()) {
    console.log(`${service.name}: ${await stopService(service)}`);
  }
}

/** The last `lines` lines of a service's log. */
export function tailLines(service: Service, lines: number): string {
  if (!existsSync(logFile(service))) return '';
  return readFileSync(logFile(service), 'utf8')
    .split(/\r?\n/)
    .slice(-lines - 1)
    .join('\n');
}

/** Follows a log: prints what is appended, until the process is stopped. */
export async function followLog(service: Service): Promise<never> {
  let shown = existsSync(logFile(service)) ? readFileSync(logFile(service)).length : 0;
  for (;;) {
    await sleep(500);
    if (!existsSync(logFile(service))) continue;
    const data = readFileSync(logFile(service));
    if (data.length < shown) shown = 0;
    if (data.length > shown) process.stdout.write(data.subarray(shown).toString('utf8'));
    shown = data.length;
  }
}

/** Runs `docker compose` against the shard's compose file and returns stdout. */
export async function compose(shard: string, args: string[]): Promise<string> {
  const file = join(ROOT, 'compose', `${shard}.yml`);
  const { stdout } = await execFileAsync(
    'docker',
    ['compose', '-f', file, '-p', `geldar-${shard}`, ...args],
    {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return stdout;
}
