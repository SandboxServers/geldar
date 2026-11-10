/**
 * `./geldar.ps1 adam-run <32b|8b|smoke> start|status|stop|report`. The run folder is `.geldar/runs/<run-id>`.
 * `start` runs the sequence in the foreground and writes `run.pid.json` so `status` and `stop` from another shell can
 * find it; `stop` asks it to end through a stop-request file, or runs the safe stop when no live run owns the folder.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AbortCriteria } from './abort.ts';
import {
  createClock,
  createFileStore,
  createGlassClient,
  createPreflight,
  createProcesses,
  createReporter,
  createRunner,
  createSampler,
  createSupervisor,
  listDir,
} from './adapters.ts';
import { LIFE_ID, PROFILES, type Profile } from './manifest.ts';
import {
  type Clock,
  type FileStore,
  type Processes,
  type Reporter,
  runPaths,
  type Sampler,
  type Supervisor,
} from './ports.ts';
import { checkPreconditions } from './preconditions.ts';
import { SERVICE_MARKERS, safeStop } from './safe-stop.ts';
import { type Preflight, type RunInput, type RunOutcome, runSequence } from './sequence.ts';
import { MINUTE_MS } from './status-log.ts';
import {
  createWorldVolumes,
  parsePrepared,
  preparedText,
  prepareWorldVolume,
  type WorldVolumes,
} from './world-volume.ts';

export const USAGE =
  'usage: adam-run <32b|8b|smoke> <start|status|stop|report|prepare-volume> [--run-id <id>] [--hours <n>] ' +
  '[--restart-at-hours <n>] [--body-kill-after-minutes <n>] [--dry-run]';
const COMMANDS = ['start', 'status', 'stop', 'report', 'prepare-volume'] as const;
type Command = (typeof COMMANDS)[number];
const VALUE_FLAGS = ['--run-id', '--hours', '--restart-at-hours', '--body-kill-after-minutes'];
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const DEFAULT_HOURS: Record<Profile, number> = { '32b': 3, '8b': 3, smoke: 0.5 };
const RUN_MARKER = 'adam-run/src/cli.ts';
const PID_FILE = 'run.pid.json';
const STOP_FILE = 'stop-request.json';

export interface Args {
  profile: Profile;
  command: Command;
  runId: string | null;
  hours: number | null;
  restartAtHours: number | null;
  bodyKillAfterMinutes: number | null;
  dryRun: boolean;
}

export type ParseResult = { ok: true; args: Args } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

const positive = (text: string): number | null => {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Every problem is a usage error (exit 2): an unknown profile, command or flag, a missing or bad value. */
export function parseArgs(argv: string[]): ParseResult {
  const [profile, command, ...rest] = argv;
  if (!(PROFILES as readonly string[]).includes(profile ?? ''))
    return fail(`unknown profile "${profile ?? ''}"`);
  if (!(COMMANDS as readonly string[]).includes(command ?? ''))
    return fail(`unknown command "${command ?? ''}"`);
  if (command === 'prepare-volume' && profile === 'smoke') {
    return fail('prepare-volume is for 32b and 8b; the smoke run uses no world volume');
  }
  const args: Args = {
    profile: profile as Profile,
    command: command as Command,
    runId: null,
    hours: null,
    restartAtHours: null,
    bodyKillAfterMinutes: null,
    dryRun: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i] ?? '';
    if (flag === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) return fail(`unknown flag "${flag}"`);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) return fail(`${flag} needs a value`);
    if (flag === '--run-id') {
      if (!RUN_ID.test(value))
        return fail(`--run-id "${value}" may use letters, digits, dot, dash and underscore`);
      args.runId = value;
    } else if (flag === '--hours') {
      args.hours = positive(value);
      if (args.hours === null) return fail(`--hours must be a positive number, got "${value}"`);
    } else if (flag === '--restart-at-hours') {
      args.restartAtHours = positive(value);
      if (args.restartAtHours === null)
        return fail(`--restart-at-hours must be positive, got "${value}"`);
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0)
        return fail(`--body-kill-after-minutes must be zero or more, got "${value}"`);
      args.bodyKillAfterMinutes = n;
    }
  }
  if (args.dryRun && args.command !== 'start') return fail('--dry-run applies to start only');
  const hours = args.hours ?? DEFAULT_HOURS[args.profile];
  if (args.restartAtHours !== null && args.restartAtHours >= hours) {
    return fail('--restart-at-hours must be before the end of the run');
  }
  return { ok: true, args };
}

/** The seams the CLI uses. The real harness is built in `realHarness`; tests pass fakes that record calls. */
export interface Harness {
  clock: Clock;
  processes: Processes;
  supervisor: Supervisor;
  /** The sampler for one profile's life id. */
  sampler(profile: Profile): Sampler;
  /** The file store of the run folder, and of the runs root (for the gate file and the 8B marker). */
  runFiles(runDir: string): FileStore;
  runsFiles: FileStore;
  /** The names of the folders under the runs root; none when the root is missing. */
  runFolders(): string[];
  /** The Docker port of the world volume (`prepare-volume`, and the precondition check). */
  worldVolumes: WorldVolumes;
  preflight(profile: Profile, runDir: string): Preflight;
  reporter(runDir: string, profile: Profile): Reporter;
  criteria: AbortCriteria;
  criteriaText: string;
}

interface PidRecord {
  pid: number;
  startedAt: string;
  runId: string;
}

/**
 * A live run owns the folder when its pid, its command line and its start time all match the pid file. The run id is
 * not in the command line when the operator started the run without --run-id: the id is generated inside, after the
 * process has started. The marker, the pid and the start time identify the process all the same.
 */
function liveOwner(h: Harness, runDir: string): PidRecord | null {
  const text = h.runFiles(runDir).read(join(runDir, PID_FILE));
  if (text === null) return null;
  let rec: PidRecord;
  try {
    rec = JSON.parse(text) as PidRecord;
  } catch {
    return null;
  }
  const recorded = Date.parse(rec.startedAt);
  const found = h.processes.list().find((p) => p.pid === rec.pid);
  if (found === undefined || Number.isNaN(recorded)) return null;
  const line = found.commandLine.replace(/\\/g, '/');
  const started = Date.parse(found.startedAt);
  const sameRun = line.includes(RUN_MARKER);
  const sameStart = Math.abs(started - recorded) < 2 * MINUTE_MS;
  return sameRun && sameStart ? rec : null;
}

function runState(h: Harness, runDir: string): { state: string; last: string } {
  const files = h.runFiles(runDir);
  if (parsePrepared(files.read(runPaths(runDir).manifest)) !== null) {
    return { state: 'prepared', last: 'no run yet: the folder holds a prepared world volume only' };
  }
  const lines = (files.read(runPaths(runDir).status) ?? '')
    .trim()
    .split('\n')
    .filter((l) => l !== '');
  const last = lines.at(-1) ?? 'no status line yet';
  const event = lines.length > 0 ? (JSON.parse(last) as { event?: string }).event : undefined;
  if (event === 'end') return { state: 'finished', last };
  // Written only for a life that died: a survival FAIL, terminal, never retried. Checked before the abort record,
  // because the safe stop writes that record for an ended life too.
  if (event === 'ended') return { state: 'ended (life_ended)', last };
  if (files.read(runPaths(runDir).abort) !== null) return { state: 'aborted', last };
  return { state: liveOwner(h, runDir) === null ? 'stopped' : 'running', last };
}

/** The newest run folder of a profile. Run ids carry a fixed-width UTC timestamp, so the last name in order is the latest. */
function latestRunId(folders: string[], profile: Profile): string | null {
  const id = new RegExp(`^${profile}-\\d{8}T\\d{6}Z$`);
  return (
    folders
      .filter((f) => id.test(f))
      .sort()
      .at(-1) ?? null
  );
}

/** The manifest's start time, or undefined when the manifest is missing or holds none. */
function startedAtOf(manifestText: string | null): string | undefined {
  if (manifestText === null) return undefined;
  return (JSON.parse(manifestText) as { started_at?: string }).started_at;
}

/** The rule and reason of an abort before the start. No sample was taken, so every criterion is UNKNOWN. */
function abortedBeforeStartText(abortText: string, criteria: AbortCriteria): string {
  const rec = JSON.parse(abortText) as { rule?: string; reason?: string };
  return [
    'state: aborted before the run started',
    `rule: ${rec.rule ?? 'unknown'}`,
    `reason: ${rec.reason ?? 'none recorded'}`,
    'criteria (no sample was taken, so all are UNKNOWN):',
    ...Object.keys(criteria).map((k) => `  ${k}: UNKNOWN`),
  ].join('\n');
}

/** Runs the CLI with the given harness. Returns the exit code: 0 done, 1 refused or failed, 2 usage. */
export async function runCli(
  argv: string[],
  repoRoot: string,
  h: Harness,
  log: (s: string) => void,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log(`adam-run: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const a = parsed.args;
  const runsDir = join(repoRoot, '.geldar', 'runs');
  // status, report and stop read an existing run: with no --run-id they take the profile's newest folder.
  const readsRun = a.command === 'status' || a.command === 'report' || a.command === 'stop';
  const latest = latestRunId(h.runFolders(), a.profile);
  if (a.runId === null && readsRun && latest === null) {
    log(`adam-run: no ${a.profile} run under ${runsDir}`);
    return 1;
  }
  const newId = `${a.profile}-${new Date(h.clock.nowMs()).toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
  const runId = a.runId ?? (readsRun ? latest : null) ?? newId;
  const runDir = join(runsDir, runId);
  const files = h.runFiles(runDir);

  // A run aborted before its manifest had a start time: the abort record is all there is.
  const abortText = files.read(runPaths(runDir).abort);
  const beforeStart =
    abortText !== null && startedAtOf(files.read(runPaths(runDir).manifest)) === undefined;
  if (beforeStart && (a.command === 'status' || a.command === 'report')) {
    log(abortedBeforeStartText(abortText, h.criteria));
    return 0;
  }
  if (beforeStart && a.command === 'stop') {
    log('the run is already aborted; nothing to stop');
    return 0;
  }

  if (a.command === 'status') {
    if (files.read(runPaths(runDir).manifest) === null) {
      log(`adam-run: no run at ${runDir}`);
      return 1;
    }
    const st = runState(h, runDir);
    log(`state: ${st.state}\nlast: ${st.last}`);
    return 0;
  }

  if (a.command === 'stop') {
    if (files.read(runPaths(runDir).manifest) === null) {
      log(`adam-run: no run at ${runDir}`);
      return 1;
    }
    if (liveOwner(h, runDir) !== null) {
      files.write(
        join(runDir, STOP_FILE),
        JSON.stringify({ requestedAt: new Date(h.clock.nowMs()).toISOString() }),
      );
      log('stop requested; the running sequence ends within a minute with an operator_stop abort');
      return 0;
    }
    const st = runState(h, runDir);
    if (st.state === 'finished' || st.state === 'aborted' || st.state === 'ended (life_ended)') {
      log(`the run is already ${st.state}; nothing to stop`);
      return 0;
    }
    if (st.state === 'prepared') {
      log('the folder holds a prepared world volume only; no run to stop, no safe stop run');
      return 0;
    }
    const manifest = JSON.parse(files.read(runPaths(runDir).manifest) ?? '{}') as {
      started_at?: string;
    };
    const outcome = await safeStop(
      { clock: h.clock, files, processes: h.processes, supervisor: h.supervisor },
      {
        runDir,
        runStartedAtMs: Date.parse(manifest.started_at ?? '') || h.clock.nowMs(),
        rule: 'operator_stop',
        reason: 'stop with no live run in this folder',
        lastObservation: null,
      },
    );
    log(`safe stop: orphans ${outcome.orphans}, exit ${outcome.exitCode}`);
    return outcome.exitCode;
  }

  if (a.command === 'prepare-volume') {
    const res = await prepareWorldVolume(
      { volumes: h.worldVolumes, files, nowMs: h.clock.nowMs() },
      { profile: a.profile, runId, runDir },
    );
    if (!res.ok) {
      log(`adam-run: prepare-volume refused: ${res.error}`);
      return 1;
    }
    log(preparedText(res.record, runDir));
    return 0;
  }

  if (a.command === 'report') {
    if (files.read(runPaths(runDir).manifest) === null) {
      log(`adam-run: no run at ${runDir}`);
      return 1;
    }
    if (parsePrepared(files.read(runPaths(runDir).manifest)) !== null) {
      log(`adam-run: ${runDir} holds a prepared world volume only; there is no run to report`);
      return 1;
    }
    try {
      await h.reporter(runDir, a.profile).reportRun(runId);
      log(`report written to ${runDir}`);
      return 0;
    } catch (err) {
      log(`adam-run: report failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // start
  const pre = await h.preflight(a.profile, runDir).gather();
  const verdict = checkPreconditions(pre.facts);
  const hours = a.hours ?? DEFAULT_HOURS[a.profile];
  const now = h.clock.nowMs();
  const plan = [
    `profile ${a.profile}, life ${LIFE_ID[a.profile]}, run ${runId}`,
    `folder ${runDir}`,
    `duration ${hours} h, planned restart ${a.restartAtHours === null ? 'none' : `at ${a.restartAtHours} h`}`,
    `Body kill ${a.bodyKillAfterMinutes === null ? 'none' : `after ${a.bodyKillAfterMinutes} min at an active intent`}`,
  ];
  if (!verdict.ok) {
    log(`adam-run: start refused:\n${verdict.missing.map((m) => `  - ${m}`).join('\n')}`);
    return 1;
  }
  if (a.dryRun) {
    log(
      `dry run: preconditions pass; this would start:\n${plan.map((p) => `  ${p}`).join('\n')}\nnothing was started`,
    );
    return 0;
  }
  // The rest of this function is the real start path; the dry run returns above and makes no supervisor call.
  const held = files.read(runPaths(runDir).manifest);
  // A prepared record is accepted: the run manifest replaces it when the sequence writes the manifest.
  if (liveOwner(h, runDir) !== null || (held !== null && parsePrepared(held) === null)) {
    log(`adam-run: start refused: ${runDir} already holds a run`);
    return 1;
  }
  // The stack is one shared set of services: a start while another run's services are alive would share them.
  const others = h.processes
    .list()
    .filter((p) => SERVICE_MARKERS.some((m) => p.commandLine.includes(m)));
  if (others.length > 0) {
    log(
      `adam-run: start refused: ${others.length} service process(es) of another run are alive (pids ${others.map((p) => p.pid).join(', ')})`,
    );
    return 1;
  }
  const rec: PidRecord = { pid: process.pid, startedAt: new Date(now).toISOString(), runId };
  files.write(join(runDir, PID_FILE), JSON.stringify(rec));
  const input: RunInput = {
    runId,
    runDir,
    profile: a.profile,
    seed: 0,
    durationMs: hours * 60 * MINUTE_MS,
    plannedRestartAtMs: a.restartAtHours === null ? null : now + a.restartAtHours * 60 * MINUTE_MS,
    bodyKillAtMs: a.bodyKillAfterMinutes === null ? null : now + a.bodyKillAfterMinutes * MINUTE_MS,
  };
  const sampler = h.sampler(a.profile);
  let outcome: RunOutcome;
  try {
    outcome = await runSequence(
      {
        clock: h.clock,
        files,
        processes: h.processes,
        sampler,
        supervisor: h.supervisor,
        reporter: h.reporter(runDir, a.profile),
        preflight: h.preflight(a.profile, runDir),
        criteria: h.criteria,
        stopRequested: () => files.read(join(runDir, STOP_FILE)) !== null,
      },
      input,
    );
  } finally {
    // The SQL connection must not outlive the run: an open socket keeps the process alive.
    await sampler.close?.().catch(() => undefined);
  }
  const detail =
    outcome.status === 'aborted'
      ? ` (${outcome.rule})`
      : outcome.status === 'ended'
        ? ` (${outcome.reason})`
        : '';
  log(`run ${runId}: ${outcome.status}${detail}`);
  return outcome.status === 'completed' ? 0 : 1;
}

/** The real harness: the OS process table, the adam CLI, Docker, Ollama and the glass reader. */
export function realHarness(repoRoot: string, env: Record<string, string | undefined>): Harness {
  const runner = createRunner(repoRoot);
  const clock = createClock();
  const processes = createProcesses();
  const criteriaText = readFileSync(
    join(repoRoot, 'tools', 'adam-run', 'abort-criteria.json'),
    'utf8',
  );
  const criteria = JSON.parse(criteriaText) as AbortCriteria;
  const worldVolumes = createWorldVolumes(runner);
  return {
    clock,
    processes,
    supervisor: createSupervisor(runner, repoRoot),
    sampler: (profile) =>
      createSampler({
        runner,
        sql: createGlassClient(env),
        processes,
        clock,
        lifeId: () => LIFE_ID[profile],
        repoRoot,
      }),
    runFiles: (dir) => createFileStore(dir),
    runsFiles: createFileStore(join(repoRoot, '.geldar', 'runs')),
    runFolders: () => listDir(join(repoRoot, '.geldar', 'runs')),
    preflight: (profile, runDir) =>
      createPreflight({
        runner,
        repoRoot,
        runDir,
        profile,
        criteriaText,
        files: createFileStore(runDir),
        worldVolumes,
        sql: createGlassClient(env),
        env,
      }),
    reporter: (runDir, profile) =>
      createReporter(
        runner,
        repoRoot,
        runDir,
        createFileStore(runDir),
        clock,
        (p) => LIFE_ID[p],
        profile,
        env,
      ),
    criteria,
    criteriaText,
    worldVolumes,
  };
}

export async function run(argv: string[]): Promise<number> {
  const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  return runCli(argv, repoRoot, realHarness(repoRoot, process.env), (s) => console.log(s));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
