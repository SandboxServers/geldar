/**
 * `./geldar.ps1 glass up|down|status|logs`: the Glass server as one detached Node process bound to 127.0.0.1.
 * Glass reads its password from the file `GELDAR_GLASS_PG_PASSWORD_FILE` names; this tool passes the path and never
 * opens the file, so the password cannot reach a line of output or of the log.
 */
import { join } from 'node:path';
import { type GlassFs, rotateLog, TAIL_BYTES, tailBytes } from './fs-ops.ts';
import { formatPidFile, type PidRecord, parsePidFile } from './pid-file.ts';
import { type ProcessOps, probeStart, stopProcess, verifyProcess } from './process-ops.ts';

/** The only address Glass may bind to; the same check glass/src/config.ts makes. */
export const GLASS_HOST = '127.0.0.1';
/** The text the Glass command line must show for `down` to stop the process (path separators are normalised). */
export const GLASS_MARKER = 'glass/src/main.ts';
const DEFAULT_PORT = 8787;

/** Fetches a URL on loopback and returns its HTTP status. Rejects when nothing answers. */
export type FetchStatus = (url: string) => Promise<number>;

export interface GlassPaths {
  mainTs: string;
  passwordFile: string;
  logDir: string;
  pidFile: string;
  logFile: string;
}

export function glassPaths(repoRoot: string): GlassPaths {
  const logDir = join(repoRoot, '.geldar', 'glass');
  return {
    mainTs: join(repoRoot, 'glass', 'src', 'main.ts'),
    passwordFile: join(repoRoot, 'compose', 'secrets', 'postgres-glass.txt'),
    logDir,
    pidFile: join(logDir, 'glass.pid'),
    logFile: join(logDir, 'glass.log'),
  };
}

/** Everything a command touches. The CLI passes the real ones; the tests pass fakes. */
export interface GlassDeps {
  repoRoot: string;
  paths: GlassPaths;
  env: NodeJS.ProcessEnv;
  fs: GlassFs;
  ops: ProcessOps;
  fetchStatus: FetchStatus;
  /** The Node binary that runs `glass/src/main.ts`. */
  nodePath: string;
}

export interface Outcome {
  exitCode: number;
  lines: string[];
}

type PidState = { kind: 'none' } | { kind: 'old' } | { kind: 'record'; record: PidRecord };

const ok = (lines: string[]): Outcome => ({ exitCode: 0, lines });
const fail = (lines: string[]): Outcome => ({ exitCode: 1, lines });

/** A host setting other than loopback is refused, as glass/src/config.ts refuses it. */
export function loopbackProblem(env: NodeJS.ProcessEnv): string | null {
  if (env.GELDAR_GLASS_HOST === undefined || env.GELDAR_GLASS_HOST === GLASS_HOST) return null;
  return `GELDAR_GLASS_HOST is "${env.GELDAR_GLASS_HOST}"; Glass binds to ${GLASS_HOST} only. Not started.`;
}

/** The port Glass listens on, or null when the setting is not an integer from 1 to 65535. */
export function glassPort(env: NodeJS.ProcessEnv): number | null {
  const raw = env.GELDAR_GLASS_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

/** The environment the Glass child gets: the caller's, with the loopback host and the password file path. */
export function childEnv(env: NodeJS.ProcessEnv, paths: GlassPaths): NodeJS.ProcessEnv {
  return {
    ...env,
    GELDAR_GLASS_HOST: GLASS_HOST,
    GELDAR_GLASS_PG_PASSWORD_FILE: paths.passwordFile,
  };
}

function readState(deps: GlassDeps): PidState {
  const text = deps.fs.readText(deps.paths.pidFile);
  if (text === null) return { kind: 'none' };
  const parsed = parsePidFile(text);
  return parsed.kind === 'current' ? { kind: 'record', record: parsed.record } : { kind: 'old' };
}

const OLD_FILE_LINE = (deps: GlassDeps): string =>
  `${deps.paths.pidFile} is in an old format and is not trusted; delete it by hand after checking its process`;

/** Starts Glass detached, appending its output to the log, and writes the format-2 PID file. */
export async function glassUp(deps: GlassDeps): Promise<Outcome> {
  const { env, fs, ops, paths } = deps;
  const refused = loopbackProblem(env);
  if (refused !== null) return fail([refused]);
  const port = glassPort(env);
  if (port === null) return fail(['GELDAR_GLASS_PORT must be an integer from 1 to 65535']);
  if (!fs.exists(paths.passwordFile)) {
    return fail([
      `${paths.passwordFile} is missing: create it with the geldar_glass password (glass/README.md)`,
    ]);
  }
  const state = readState(deps);
  if (state.kind === 'old') return fail([OLD_FILE_LINE(deps)]);
  if (state.kind === 'record') {
    const { record } = state;
    const verdict = verifyProcess(record, GLASS_MARKER, ops);
    if (verdict === 'owned')
      return ok([`glass is already up (pid ${record.pid}) at http://${GLASS_HOST}:${port}/`]);
    if (verdict === 'unverifiable') {
      return fail([
        `pid ${record.pid} cannot be verified; not started over it. Run ./geldar.ps1 glass down first.`,
      ]);
    }
    fs.remove(paths.pidFile); // dead or another process: the file is stale; nothing is signalled.
  }
  fs.mkdir(paths.logDir);
  rotateLog(fs, paths.logFile);
  let pid: number | undefined;
  try {
    pid = ops.spawnDetached({
      command: deps.nodePath,
      args: [paths.mainTs],
      cwd: deps.repoRoot,
      env: childEnv(env, paths),
      logPath: paths.logFile,
    });
  } catch (error) {
    return fail([`glass did not start: ${(error as Error).message}`]);
  }
  // No PID means no process: nothing is recorded, so a later `down` has nothing to stop.
  if (pid === undefined) return fail(['glass did not start: the spawn gave no process id']);
  const started = await probeStart(pid, ops);
  fs.writeText(paths.pidFile, formatPidFile({ pid, started, marker: GLASS_MARKER }));
  return ok([
    `glass started (pid ${pid}, log ${paths.logFile})`,
    `open http://${GLASS_HOST}:${port}/ once the log says "glass listening"`,
  ]);
}

/** Stops Glass, but only the process the PID file names when it is still Glass. */
export async function glassDown(deps: GlassDeps): Promise<Outcome> {
  const { fs, ops, paths } = deps;
  const state = readState(deps);
  if (state.kind === 'none') return ok(['glass is not running (no pid file)']);
  if (state.kind === 'old') return fail([OLD_FILE_LINE(deps)]);
  const { record } = state;
  const verdict = verifyProcess(record, GLASS_MARKER, ops);
  if (verdict === 'unverifiable') {
    return fail([
      `pid ${record.pid} cannot be verified (start time or command line unreadable); not killed; pid file kept`,
    ]);
  }
  if (verdict === 'dead' || verdict === 'mismatch') {
    fs.remove(paths.pidFile);
    const note =
      verdict === 'mismatch' ? `; pid ${record.pid} is another process and was not killed` : '';
    return ok([`glass is not running; stale pid file removed${note}`]);
  }
  const result = await stopProcess(record, GLASS_MARKER, ops);
  if (result.kind === 'stopped') {
    fs.remove(paths.pidFile);
    return ok([`glass stopped (${result.how}, pid ${record.pid})`]);
  }
  if (result.kind === 'not-running' || result.kind === 'mismatch') {
    fs.remove(paths.pidFile);
    return ok([`glass is not running; stale pid file removed`]);
  }
  return fail([result.kind === 'failed' ? result.reason : `${result.reason}; pid file kept`]);
}

/** One line for the process, the URL, and the probe of the thoughts API on loopback. */
export async function glassStatus(deps: GlassDeps): Promise<Outcome> {
  const port = glassPort(deps.env);
  const state = readState(deps);
  let processLine: string;
  if (state.kind === 'none') processLine = 'down (no pid file)';
  else if (state.kind === 'old') processLine = 'unknown (old pid file, not trusted)';
  else {
    const { record } = state;
    const verdict = verifyProcess(record, GLASS_MARKER, deps.ops);
    if (verdict === 'owned') processLine = `up (pid ${record.pid})`;
    else if (verdict === 'unverifiable')
      processLine = `unknown (pid ${record.pid} cannot be verified)`;
    else processLine = `down (stale pid file: pid ${record.pid} is not Glass)`;
  }
  if (port === null)
    return ok([`glass ${processLine}`, 'probe skipped: GELDAR_GLASS_PORT is not a valid port']);
  const url = `http://${GLASS_HOST}:${port}/`;
  let probe: string;
  try {
    const status = await deps.fetchStatus(`http://${GLASS_HOST}:${port}/api/thoughts?limit=1`);
    probe = `GET /api/thoughts answers (HTTP ${status})`;
  } catch (error) {
    probe = `GET /api/thoughts does not answer (${(error as Error).message})`;
  }
  return ok([`glass ${processLine}`, `url ${url}`, `probe ${probe}`]);
}

/** The last 64 KB of the log, as lines. */
export function glassLogs(deps: GlassDeps): Outcome {
  if (!deps.fs.exists(deps.paths.logFile)) return ok(['glass: no log yet']);
  return ok(tailBytes(deps.fs, deps.paths.logFile, TAIL_BYTES));
}

export const USAGE = 'usage: ./geldar.ps1 glass <up|down|status|logs>';

/** Runs one verb. An unknown verb is exit 2, and its line is the usage. */
export async function runGlass(verb: string | undefined, deps: GlassDeps): Promise<Outcome> {
  if (verb === 'up') return glassUp(deps);
  if (verb === 'down') return glassDown(deps);
  if (verb === 'status') return glassStatus(deps);
  if (verb === 'logs') return glassLogs(deps);
  return { exitCode: 2, lines: [USAGE] };
}
