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
  formatPidFile,
  formatStatus,
  listRangers,
  type Presence,
  parsePidFile,
  type Ranger,
  RangerError,
  rangerCommand,
  rangerMarker,
  rangerState,
  selectRangers,
} from './rangers.ts';
import { readPresence } from './rangers-presence.ts';
import { type ProcessOps, productionOps, stopRangerProcess } from './rangers-process.ts';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const RUN_DIR = join(REPO_ROOT, '.geldar', 'players');

export const USAGE = `usage: ./geldar.ps1 players <up|down|status|logs> [--player <player-id>]

  up      start one Body process per ranger (or the one named); a running ranger is left alone
  down    stop the named ranger's Body (or all of them)
  status  print each ranger's process (PID, resident memory) and its presence record (awake, dim or
          hibernating); "presence: unknown" when NATS cannot be read; prints "down" when none runs
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

const pidFile = (dir: string, ranger: Ranger) => join(dir, `${ranger.playerId}.pid`);
const logFile = (dir: string, ranger: Ranger) => join(dir, `${ranger.playerId}.log`);

function readPidText(dir: string, ranger: Ranger): string | null {
  return existsSync(pidFile(dir, ranger)) ? readFileSync(pidFile(dir, ranger), 'utf8') : null;
}

const isAlive = (pid: number): boolean => productionOps().alive(pid);

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

/** One ranger's line of output, and whether that ranger failed (a failure sets exit code 1). */
export interface RangerLine {
  line: string;
  failed: boolean;
}

function start(dir: string, ranger: Ranger): RangerLine {
  const state = rangerState(readPidText(dir, ranger), isAlive);
  if (state.state === 'online') {
    return { line: `${ranger.playerId} already running (pid ${state.pid})`, failed: false };
  }
  // An old PID file names a live process that cannot be verified: starting over it could collide on the name.
  if (state.state === 'stale' && state.pid !== null && isAlive(state.pid)) {
    return {
      line: `${ranger.playerId} not started: an old pid file names live pid ${state.pid}; stop it by hand and delete ${pidFile(dir, ranger)}`,
      failed: true,
    };
  }
  mkdirSync(dir, { recursive: true });
  const out = openSync(logFile(dir, ranger), 'a');
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
    // An unreadable start time is stored empty: `down` then refuses to stop the process, and says why.
    const started = productionOps().identity(child.pid)?.started ?? '';
    const record = { pid: child.pid, started, marker: rangerMarker(ranger.playerId) };
    writeFileSync(pidFile(dir, ranger), formatPidFile(record));
    return {
      line: `${ranger.playerId} started (pid ${child.pid}, log ${logFile(dir, ranger)})`,
      failed: false,
    };
  } finally {
    closeSync(out);
  }
}

/** Stops the ranger's Body. The PID file is removed only once its process has exited, or was never ours. */
async function stop(dir: string, ranger: Ranger, ops: ProcessOps): Promise<RangerLine> {
  const text = readPidText(dir, ranger);
  if (text === null) return { line: `${ranger.playerId} down`, failed: false };
  const file = parsePidFile(text);
  if (file.kind === 'old') {
    if (file.pid !== null && ops.alive(file.pid)) {
      return {
        line: `${ranger.playerId} not stopped: an old pid file names live pid ${file.pid}, which cannot be verified; stop it by hand`,
        failed: true,
      };
    }
    unlinkSync(pidFile(dir, ranger));
    return { line: `${ranger.playerId} down (old pid file removed)`, failed: false };
  }
  const result = await stopRangerProcess(file.record, ops);
  if (result.kind === 'failed') {
    return { line: `${ranger.playerId} not stopped: ${result.reason}`, failed: true };
  }
  unlinkSync(pidFile(dir, ranger));
  if (result.kind === 'stopped') {
    return {
      line: `${ranger.playerId} stopped (${result.how}, pid ${file.record.pid})`,
      failed: false,
    };
  }
  const note = result.kind === 'refused' ? result.reason : 'stale pid file removed';
  return { line: `${ranger.playerId} down (${note})`, failed: false };
}

/** Runs one step per ranger; a throw is that ranger's failure, and the others still run. */
export async function eachRanger(
  rangers: readonly Ranger[],
  step: (ranger: Ranger) => Promise<RangerLine>,
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  let failures = 0;
  for (const ranger of rangers) {
    const result = await step(ranger).catch(
      (error: unknown): RangerLine => ({
        line: `${ranger.playerId} failed: ${error instanceof Error ? error.message : String(error)}`,
        failed: true,
      }),
    );
    lines.push(result.line);
    if (result.failed) failures += 1;
  }
  if (failures > 0) lines.push(`${failures} of ${rangers.length} failed`);
  return { code: failures === 0 ? 0 : 1, lines };
}

/** What `status` reads beyond the PID files, and where the PID files live. Fakes replace these in tests. */
export interface RangerDeps {
  readPresence(lifeIds: readonly string[]): Promise<Map<string, Presence>>;
  /** The process calls `down` makes. */
  ops: ProcessOps;
  /** The directory of the PID and log files. */
  runDir: string;
}

const PRODUCTION_DEPS: RangerDeps = {
  readPresence: (lifeIds) => readPresence(process.env.GELDAR_NATS_URL, lifeIds),
  ops: productionOps(),
  runDir: RUN_DIR,
};

/** Runs one command and returns the exit code. Status exits 0 whether or not anything runs. */
export async function runRangersCli(
  argv: readonly string[],
  shardYaml: string,
  overrides: Partial<RangerDeps> = {},
): Promise<{ code: number; lines: string[] }> {
  const deps = { ...PRODUCTION_DEPS, ...overrides };
  const dir = deps.runDir;
  const [verb, ...rest] = argv;
  const options = parseOptions(rest);
  if (options === null || verb === undefined) return { code: 2, lines: [USAGE] };
  try {
    const rangers = selectRangers(listRangers(shardYaml), options.playerId);
    if (verb === 'up') return await eachRanger(rangers, async (ranger) => start(dir, ranger));
    if (verb === 'down') {
      return await eachRanger(rangers, (ranger) => stop(dir, ranger, deps.ops));
    }
    if (verb === 'status') {
      const presence = await deps.readPresence(rangers.map((ranger) => ranger.lifeId));
      const rows = rangers.map((ranger) => {
        const state = rangerState(readPidText(dir, ranger), isAlive);
        return {
          ranger,
          ...state,
          rssMb: state.pid === null || state.state !== 'online' ? null : rssMb(state.pid),
          presence: presence.get(ranger.lifeId) ?? { kind: 'unknown' as const },
        };
      });
      return { code: 0, lines: formatStatus(rows) };
    }
    if (verb === 'logs') {
      const lines = rangers.flatMap((ranger) =>
        existsSync(logFile(dir, ranger))
          ? readFileSync(logFile(dir, ranger), 'utf8').split('\n').slice(-200)
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
  runRangersCli(process.argv.slice(2), readFileSync(shardFile, 'utf8')).then(({ code, lines }) => {
    for (const line of lines) console.log(line);
    process.exitCode = code;
  });
}
