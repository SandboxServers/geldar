#!/usr/bin/env node
/**
 * `./geldar.ps1 players up|down|status|logs [--player <id>]`: one detached Body process per sovereign ranger.
 * PID files and logs live under .geldar/players/ (git-ignored). The Body itself reads the shard config.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  formatStatus,
  listRangers,
  type Ranger,
  RangerError,
  rangerCommand,
  rangerState,
  selectRangers,
} from './rangers.ts';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const RUN_DIR = join(REPO_ROOT, '.geldar', 'players');

export const USAGE = `usage: ./geldar.ps1 players <up|down|status|logs> [--player <player-id>]

  up      start one Body process per ranger (or the one named); a running ranger is left alone
  down    stop the named ranger's Body (or all of them)
  status  print each ranger's state, PID and resident memory; prints "down" when none runs
  logs    print the last 200 lines of each ranger's log (or the one named)
`;

/** Parses the arguments after the verb: `--player <id>` only. */
export function parseOptions(args: readonly string[]): { playerId: string | undefined } | null {
  if (args.length === 0) return { playerId: undefined };
  if (args.length === 2 && args[0] === '--player' && args[1] !== undefined && args[1] !== '') {
    return { playerId: args[1] };
  }
  return null;
}

const pidFile = (ranger: Ranger) => join(RUN_DIR, `${ranger.playerId}.pid`);
const logFile = (ranger: Ranger) => join(RUN_DIR, `${ranger.playerId}.log`);

function readPidText(ranger: Ranger): string | null {
  return existsSync(pidFile(ranger)) ? readFileSync(pidFile(ranger), 'utf8') : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user: alive, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Resident memory in MB, or null when the platform tool cannot say. Only the number leaves this function. */
function rssMb(pid: number): number | null {
  try {
    if (process.platform === 'win32') {
      const bytes = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      return Math.round(Number(bytes.trim()) / 1024 / 1024);
    }
    const kb = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Math.round(Number(kb.trim()) / 1024);
  } catch {
    return null;
  }
}

function start(ranger: Ranger): string {
  const state = rangerState(readPidText(ranger), isAlive);
  if (state.state === 'online') return `${ranger.playerId} already running (pid ${state.pid})`;
  mkdirSync(RUN_DIR, { recursive: true });
  const out = openSync(logFile(ranger), 'a');
  try {
    const child = spawn(process.execPath, rangerCommand(REPO_ROOT, ranger.playerId).args, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
      env: process.env,
    });
    child.unref();
    if (child.pid === undefined) throw new RangerError(`could not start ${ranger.playerId}`);
    writeFileSync(pidFile(ranger), `${child.pid}\n`);
    return `${ranger.playerId} started (pid ${child.pid}, log ${logFile(ranger)})`;
  } finally {
    closeSync(out);
  }
}

function stop(ranger: Ranger): string {
  const state = rangerState(readPidText(ranger), isAlive);
  if (state.pid !== null && state.state === 'online') process.kill(state.pid, 'SIGTERM');
  if (existsSync(pidFile(ranger))) unlinkSync(pidFile(ranger));
  return state.state === 'online'
    ? `${ranger.playerId} stopping (pid ${state.pid})`
    : `${ranger.playerId} down`;
}

/** Runs one command and returns the exit code. Status exits 0 whether or not anything runs. */
export function runRangersCli(
  argv: readonly string[],
  shardYaml: string,
): { code: number; lines: string[] } {
  const [verb, ...rest] = argv;
  const options = parseOptions(rest);
  if (options === null || verb === undefined) return { code: 2, lines: [USAGE] };
  try {
    const rangers = selectRangers(listRangers(shardYaml), options.playerId);
    if (verb === 'up') return { code: 0, lines: rangers.map(start) };
    if (verb === 'down') return { code: 0, lines: rangers.map(stop) };
    if (verb === 'status') {
      const rows = rangers.map((ranger) => {
        const state = rangerState(readPidText(ranger), isAlive);
        return {
          ranger,
          ...state,
          rssMb: state.pid === null || state.state !== 'online' ? null : rssMb(state.pid),
        };
      });
      return { code: 0, lines: formatStatus(rows) };
    }
    if (verb === 'logs') {
      const lines = rangers.flatMap((ranger) =>
        existsSync(logFile(ranger))
          ? readFileSync(logFile(ranger), 'utf8').split('\n').slice(-200)
          : [`${ranger.playerId}: no log yet`],
      );
      return { code: 0, lines };
    }
    return { code: 2, lines: [USAGE] };
  } catch (error) {
    const message =
      error instanceof RangerError ? error.message : 'the command failed; see the README';
    return { code: error instanceof RangerError ? 2 : 1, lines: [`error: ${message}`] };
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const shardFile = join(REPO_ROOT, 'shards', `${process.env.GELDAR_SHARD ?? 'phase0'}.yaml`);
  const { code, lines } = runRangersCli(process.argv.slice(2), readFileSync(shardFile, 'utf8'));
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
