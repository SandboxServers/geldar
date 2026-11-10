/**
 * The safe stop of an Adam run (W6-13). It stops lantern-local, animus and the Body (the reverse of the start order, so
 * the Body is last), then checks that no process owned by this run remains.
 *
 * A process is owned by the run when its command line holds a service entry file (the markers below, as tools/adam-cli
 * starts the services) and it started at or after the run's start. A marker process whose start time cannot be read is
 * unverifiable: it is never signalled, and the stop exits non-zero. Owned leftovers get one graceful request, then one
 * forced kill. Idempotent: when abort.json already exists, the call changes nothing and returns the recorded result.
 */
import {
  type Clock,
  type FileStore,
  type Observation,
  type Processes,
  type ProcessView,
  runPaths,
  type Service,
  type Supervisor,
} from './ports.ts';
import { appendStatus, minuteOf, statusLine } from './status-log.ts';

/** The entry files of the services, as `adam up` starts them (golem is the Body). */
export const SERVICE_MARKERS = [
  'golem/src/adam/main.ts',
  'animus/src/main.ts',
  'lantern-local/src/main.ts',
] as const;
/** The stop order: the reverse of the start order. */
export const STOP_ORDER: readonly Service[] = ['lantern-local', 'animus', 'body'];
export const GRACEFUL_WAIT_MS = 5_000;
export const FORCE_WAIT_MS = 1_000;

export type OrphanResult = 'pass' | 'fail' | 'unverifiable';
/** `other` is not a service process of any run; `unverifiable` is a service process whose start time is unreadable. */
export type Ownership = 'other' | 'owned' | 'unverifiable';

export interface SafeStopDeps {
  clock: Clock;
  files: FileStore;
  processes: Processes;
  supervisor: Supervisor;
}

export interface SafeStopInput {
  runDir: string;
  runStartedAtMs: number;
  rule: string;
  reason: string;
  /** The last sample the run took, or null when the run never sampled. */
  lastObservation: Observation | null;
}

export interface SafeStopOutcome {
  orphans: OrphanResult;
  exitCode: 0 | 1;
  alreadyStopped: boolean;
  orphanDetail: string[];
  stopErrors: string[];
}

interface RecordedStop {
  orphanCheck: { result: OrphanResult; detail: string[] };
  stopErrors: string[];
  exitCode: 0 | 1;
}

export function ownership(p: ProcessView, runStartedAtMs: number): Ownership {
  // Windows prints backslashes and node quotes paths with spaces; the markers use forward slashes.
  const commandLine = p.commandLine.replace(/\\/g, '/').replace(/"/g, '');
  if (!SERVICE_MARKERS.some((m) => commandLine.includes(m))) return 'other';
  const started = Date.parse(p.startedAt);
  if (Number.isNaN(started)) return 'unverifiable';
  return started >= runStartedAtMs ? 'owned' : 'other';
}

async function orphanCheck(
  deps: SafeStopDeps,
  runStartedAtMs: number,
): Promise<{ result: OrphanResult; detail: string[] }> {
  const leftovers = (): { p: ProcessView; own: Ownership }[] =>
    deps.processes
      .list()
      .map((p) => ({ p, own: ownership(p, runStartedAtMs) }))
      .filter((x) => x.own !== 'other');
  let left = leftovers();
  if (left.length === 0) return { result: 'pass', detail: [] };
  for (const x of left) if (x.own === 'owned') deps.processes.signal(x.p.pid, false);
  await deps.clock.sleep(GRACEFUL_WAIT_MS);
  left = leftovers();
  for (const x of left) if (x.own === 'owned') deps.processes.signal(x.p.pid, true);
  await deps.clock.sleep(FORCE_WAIT_MS);
  left = leftovers();
  const detail = left.map((x) => `pid ${x.p.pid}: ${x.own}`);
  if (left.some((x) => x.own === 'owned')) return { result: 'fail', detail };
  if (left.some((x) => x.own === 'unverifiable')) return { result: 'unverifiable', detail };
  return { result: 'pass', detail };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function safeStop(deps: SafeStopDeps, input: SafeStopInput): Promise<SafeStopOutcome> {
  const paths = runPaths(input.runDir);
  const prior = deps.files.read(paths.abort);
  if (prior !== null) {
    const recorded = JSON.parse(prior) as RecordedStop;
    return {
      orphans: recorded.orphanCheck.result,
      exitCode: recorded.exitCode,
      alreadyStopped: true,
      orphanDetail: recorded.orphanCheck.detail,
      stopErrors: recorded.stopErrors,
    };
  }
  const stopErrors: string[] = [];
  for (const service of STOP_ORDER) {
    try {
      await deps.supervisor.stop(service);
    } catch (err) {
      stopErrors.push(`${service}: ${message(err)}`);
    }
  }
  const orphan = await orphanCheck(deps, input.runStartedAtMs);
  const exitCode: 0 | 1 = orphan.result === 'pass' && stopErrors.length === 0 ? 0 : 1;
  const at = deps.clock.nowMs();
  const last = input.lastObservation;
  const record = {
    schema: 'adam-run-abort/1',
    rule: input.rule,
    reason: input.reason,
    at: new Date(at).toISOString(),
    lastSample: last === null ? null : statusLine(last, minuteOf(last.atMs, input.runStartedAtMs)),
    orphanCheck: orphan,
    stopErrors,
    exitCode,
  };
  deps.files.write(paths.abort, `${JSON.stringify(record, null, 2)}\n`);
  if (last !== null) {
    const minute = minuteOf(at, input.runStartedAtMs);
    appendStatus(
      deps.files,
      paths.status,
      statusLine({ ...last, atMs: at }, minute, 'safe_stop', `orphans: ${orphan.result}`),
    );
  }
  return {
    orphans: orphan.result,
    exitCode,
    alreadyStopped: false,
    orphanDetail: orphan.detail,
    stopErrors,
  };
}
