/**
 * `restart-body`: ends the running Body process and starts a fresh one through the same spawn path `adam up` uses.
 * Nothing restarts a killed Body by itself: the supervisor in `golem/src/adam/main.ts` only sees faults raised inside
 * its own process, so a killed process stays down until this command starts another. It signals only the PID in its
 * owner record, and only when the live process still matches that record (PID, start time and command line). A
 * process it cannot verify is never signalled. The animus and lantern-local processes are never touched.
 */
import { BODY, type Service } from './procs.ts';

/** The owner record `startService` writes next to each PID file: what was started, and when. */
export interface BodyOwner {
  pid: number;
  /** When the spawn was requested (ISO), taken just before the spawn. */
  startedAt: string;
  /** The entry point the process was started with. */
  entry: string;
}

/** What the process table says about one PID. */
export interface ProcessFacts {
  pid: number;
  /** The process creation time (ISO). */
  startedAt: string;
  commandLine: string;
}

/** The Body logs this once per start (`golem/src/adam/main.ts`, `body_started`). */
const BODY_STARTED = /"event":"body_started"/;
/** A process created this far from the recorded spawn time is another process. */
const START_SLACK_MS = 10_000;

/**
 * Null when the live process is the one the owner record names. Otherwise the reason to refuse, which names what was
 * found. A missing owner record or a missing process is refused too: nothing is signalled on a guess.
 */
export function ownershipProblem(
  owner: BodyOwner | null,
  facts: ProcessFacts | null,
  entry: string,
): string | null {
  if (owner === null)
    return 'no owner record for the Body (unverifiable); run ./geldar.ps1 adam down';
  if (facts === null) return `pid ${owner.pid} is not running (stale); run ./geldar.ps1 adam down`;
  if (facts.pid !== owner.pid) return `pid ${owner.pid} answered as pid ${facts.pid}`;
  const recorded = Date.parse(owner.startedAt);
  const created = Date.parse(facts.startedAt);
  if (!Number.isFinite(recorded) || !Number.isFinite(created)) {
    return `pid ${owner.pid} has no readable start time`;
  }
  if (Math.abs(created - recorded) > START_SLACK_MS) {
    return `pid ${owner.pid} started at ${facts.startedAt}, not at the recorded ${owner.startedAt}; it is another process`;
  }
  if (!facts.commandLine.replace(/\\/g, '/').includes(entry)) {
    return `pid ${owner.pid} is not running ${entry} (command line: ${facts.commandLine})`;
  }
  return null;
}

/** The side effects `restartBody` needs; the real ones live in `run.ts`, the tests pass fakes. */
export interface RestartDeps {
  /** True when at least one service of the run is running. */
  adamUp(): boolean;
  /** The Body's owner record, or null when there is none or it cannot be read. */
  owner(): BodyOwner | null;
  /** The process table entry for a PID, or null when no such process exists. Throws when the table cannot be read. */
  lookup(pid: number): ProcessFacts | null;
  alive(pid: number): boolean;
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  /** Starts a service the way `adam up` does and returns its owner record. */
  spawn(service: Service, env: Record<string, string>): BodyOwner;
  /** The environment `adam up` gives the services. */
  env(): Record<string, string>;
  /** The Body log's length, and the text appended after an offset. */
  logSize(): number;
  logSince(offset: number): string;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface RestartOptions {
  /** How long the old Body has to exit after SIGTERM before it is killed. */
  graceMs: number;
  /** How long the new Body has to log `body_started`. */
  readyMs: number;
  pollMs: number;
}

/** Waits until a PID is gone; false when `ms` passes first. */
async function waitGone(deps: RestartDeps, pid: number, ms: number): Promise<boolean> {
  const deadline = deps.now() + ms;
  while (deps.alive(pid)) {
    if (deps.now() >= deadline) return false;
    await deps.sleep(200);
  }
  return true;
}

/** SIGTERM first (the Body keeps its checkpoint), SIGKILL only after the grace period. */
async function terminate(deps: RestartDeps, pid: number, graceMs: number): Promise<void> {
  deps.signal(pid, 'SIGTERM');
  if (await waitGone(deps, pid, graceMs)) return;
  deps.signal(pid, 'SIGKILL');
  if (!(await waitGone(deps, pid, 5_000))) throw new Error(`pid ${pid} did not exit after SIGKILL`);
}

/** Waits for `body_started` in the log after `offset`. A fresh Body that exits first, or never logs it, is an error. */
async function waitForStart(
  deps: RestartDeps,
  fresh: BodyOwner,
  offset: number,
  opts: RestartOptions,
): Promise<void> {
  const deadline = deps.now() + opts.readyMs;
  while (deps.now() < deadline) {
    if (BODY_STARTED.test(deps.logSince(offset))) return;
    if (!deps.alive(fresh.pid)) {
      throw new Error(
        `the new Body (pid ${fresh.pid}) exited before body_started; see the body log`,
      );
    }
    await deps.sleep(opts.pollMs);
  }
  // The process was started by this command, so it is stopped rather than left running unlogged.
  deps.signal(fresh.pid, 'SIGTERM');
  throw new Error(
    `the new Body (pid ${fresh.pid}) did not log body_started within ${opts.readyMs} ms`,
  );
}

/**
 * Restarts the Body. Refuses (throws, signalling nothing) when adam is not up or the Body cannot be verified. Returns
 * the one-line result for the operator.
 */
export async function restartBody(deps: RestartDeps, opts: RestartOptions): Promise<string> {
  if (!deps.adamUp())
    throw new Error('adam is not up: there is no Body to restart (./geldar.ps1 adam up)');
  const owner = deps.owner();
  const facts = owner === null ? null : deps.lookup(owner.pid);
  const problem = ownershipProblem(owner, facts, BODY.entry);
  if (owner === null || problem !== null)
    throw new Error(`refusing to restart the Body: ${problem}`);
  await terminate(deps, owner.pid, opts.graceMs);
  const offset = deps.logSize();
  const fresh = deps.spawn(BODY, deps.env());
  await waitForStart(deps, fresh, offset, opts);
  return `body restarted: pid ${owner.pid} -> ${fresh.pid}`;
}
