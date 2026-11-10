/**
 * The run state machine of an Adam run (W6-13): precheck, manifest, `adam up`, one sample a minute, the planned stack
 * restart, one Body kill mid-intent, the end at the target duration, then the report. An abort rule, or a sampler
 * error, runs the safe stop, then the Reporter (a partial window), then writes the final `abort` line. Pure over its
 * ports: the clock and sleep decide the time, so a 3-hour run takes milliseconds in the tests.
 */
import { type AbortCriteria, evaluateAbort, type Sample } from './abort.ts';
import { checkBench } from './bench-gate.ts';
import { buildManifest, type Profile, writeManifest } from './manifest.ts';
import {
  type Clock,
  type FileStore,
  type Observation,
  type Processes,
  type Reporter,
  runPaths,
  type Sampler,
  type Supervisor,
} from './ports.ts';
import { checkPreconditions, type PreconditionFacts } from './preconditions.ts';
import { safeStop } from './safe-stop.ts';
import {
  appendStatus,
  eventOnlyLine,
  MINUTE_MS,
  minuteOf,
  type StatusLine,
  statusLine,
} from './status-log.ts';

/** How long the stack may take to come back, on the same life id, after the planned restart. */
export const RESTART_WAIT_MS = 10 * MINUTE_MS;
/** How long the Body may take to reconnect after a harness kill. Shorter than the `body` abort window, so it is the one that fires. */
export const BODY_WAIT_MS = 4 * MINUTE_MS;
/** Consecutive sampler failures tolerated before the run aborts; each failure is a status.log line meanwhile. */
export const MAX_SAMPLER_FAILURES = 5;

export interface PreflightFacts {
  facts: PreconditionFacts;
  /** The world seed the shard file names; the run manifest records it. */
  seed: number;
  shardConfigSha256: string;
  /** The digest of the committed shard file when the working copy differs from it; null when it does not. */
  shardCommittedSha256: string | null;
  criteriaSha256: string;
}

/** Gathers the facts the gate needs: git, the gate file, the pins, Ollama, the prepared world volume. */
export interface Preflight {
  gather(): Promise<PreflightFacts>;
}

export interface SequenceDeps {
  clock: Clock;
  files: FileStore;
  processes: Processes;
  sampler: Sampler;
  supervisor: Supervisor;
  reporter: Reporter;
  preflight: Preflight;
  criteria: AbortCriteria;
  /** True once `stop` has asked the running sequence to end; checked each minute. Absent in tests that never stop. */
  stopRequested?: () => boolean;
}

export interface RunInput {
  runId: string;
  /** The run folder, `.geldar/runs/<run-id>`. */
  runDir: string;
  profile: Profile;
  durationMs: number;
  /** The planned stack restart, as an epoch time, or null for none. */
  plannedRestartAtMs: number | null;
  /** The planned Body kill moment: the first sample at or after it that reports an intent gets the kill. Null for none. */
  bodyKillAtMs: number | null;
}

export type RunOutcome =
  | { status: 'refused'; missing: string[] }
  | { status: 'completed'; bodyKills: number; reportFailed: boolean }
  | {
      /** The life died: a survival result, not a fault of the harness. Terminal; never retried automatically. */
      status: 'ended';
      reason: 'life_ended';
      safeStopExit: 0 | 1;
      bodyKills: number;
      reportFailed: boolean;
    }
  | {
      status: 'aborted';
      rule: string;
      reason: string;
      safeStopExit: 0 | 1;
      bodyKills: number;
      reportFailed: boolean;
    };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toSample(o: Observation): Sample {
  return {
    atMs: o.atMs,
    tps: o.tps,
    latencyP95Ms: o.latencyP95Ms,
    ollamaUp: o.alive.ollama,
    postgresUp: o.alive.postgres,
    natsUp: o.alive.nats,
    bodyConnected: o.bodyConnected,
    gpuPresent: o.gpuPresent,
    deaths: o.deaths,
    diskFreeGb: o.diskFreeGb,
    lastThoughtAtMs: o.lastThoughtAtMs,
  };
}

/** A harness line for `atMs`: the measures of `last` when a sample exists, otherwise null measures. */
function harnessLine(
  last: Observation | null,
  atMs: number,
  startMs: number,
  event: string,
  detail: string,
): StatusLine {
  const minute = minuteOf(atMs, startMs);
  return last === null
    ? eventOnlyLine(atMs, minute, event, detail)
    : statusLine({ ...last, atMs }, minute, event, detail);
}

export async function runSequence(deps: SequenceDeps, input: RunInput): Promise<RunOutcome> {
  const { clock, files, sampler, supervisor, reporter } = deps;
  const paths = runPaths(input.runDir);

  // Precheck: a refused run writes nothing and starts nothing.
  const gathered = await deps.preflight.gather();
  const verdict = checkPreconditions(gathered.facts);
  if (!verdict.ok) return { status: 'refused', missing: verdict.missing };

  const startMs = clock.nowMs();
  const f = gathered.facts;
  const benchGate = checkBench(f.bench, f.headSha);
  writeManifest(
    files,
    input.runDir,
    buildManifest({
      runId: input.runId,
      profile: input.profile,
      seed: gathered.seed,
      // The prepared record is replaced by this manifest; the volume name it held moves here.
      worldVolume: f.prepared?.worldVolume ?? null,
      startedAt: new Date(startMs).toISOString(),
      plannedRestartAt:
        input.plannedRestartAtMs === null ? null : new Date(input.plannedRestartAtMs).toISOString(),
      git: { sha: f.headSha, clean: f.otherChanges.length === 0 && f.shardEdit.kind === 'none' },
      shardConfigSha256: gathered.shardConfigSha256,
      // The select's edit is recorded only when the classifier accepted one; a refused edit never reaches a start.
      shardEdit:
        f.shardEdit.kind === 'select' && gathered.shardCommittedSha256 !== null
          ? {
              changes: f.shardEdit.changes,
              sha256Before: gathered.shardCommittedSha256,
              sha256After: gathered.shardConfigSha256,
            }
          : null,
      pins: f.pins,
      observedDigests: f.observedDigests,
      bench: benchGate.ok ? benchGate.summary : null,
      criteriaSha256: gathered.criteriaSha256,
    }),
  );

  let last: Observation | null = null;
  let samplerFailures = 0;
  let bodyKills = 0;
  let reportFailed = false;

  const report = async (now: number): Promise<void> => {
    try {
      await reporter.reportRun(input.runId);
    } catch (err) {
      reportFailed = true;
      appendStatus(
        files,
        paths.status,
        harnessLine(last, now, startMs, 'report_failed', message(err)),
      );
    }
  };

  /** The safe stop, the report, then one terminal line: `abort` for a fault, `ended` for a life that died. */
  const finish = async (event: 'abort' | 'ended', rule: string, reason: string): Promise<0 | 1> => {
    const now = clock.nowMs();
    const stop = await safeStop(
      { clock, files, processes: deps.processes, supervisor },
      { runDir: input.runDir, runStartedAtMs: startMs, rule, reason, lastObservation: last },
    );
    await report(now);
    appendStatus(
      files,
      paths.status,
      harnessLine(last, now, startMs, event, `${rule}: ${reason}; safe stop exit ${stop.exitCode}`),
    );
    return stop.exitCode;
  };

  const abortWith = async (rule: string, reason: string): Promise<RunOutcome> => {
    const safeStopExit = await finish('abort', rule, reason);
    return { status: 'aborted', rule, reason, safeStopExit, bodyKills, reportFailed };
  };

  const endWithLife = async (rule: string, reason: string): Promise<RunOutcome> => {
    const safeStopExit = await finish('ended', rule, reason);
    return { status: 'ended', reason: 'life_ended', safeStopExit, bodyKills, reportFailed };
  };

  try {
    await supervisor.up();
  } catch (err) {
    // The safe stop runs `adam down`, which ends every service on the machine. A run whose `adam up` failed did not
    // bring the stack up, so it stops nothing: a second start must never end the first run's services.
    const now = clock.nowMs();
    const reason = `adam up failed: ${message(err)}`;
    appendStatus(
      files,
      paths.status,
      harnessLine(
        last,
        now,
        startMs,
        'abort',
        `error: ${reason}; no safe stop: this run brought no services up`,
      ),
    );
    await report(now);
    return { status: 'aborted', rule: 'error', reason, safeStopExit: 0, bodyKills, reportFailed };
  }

  const history: Sample[] = [];
  const endMs = startMs + input.durationMs;
  let restartDone = false;
  let restartDeadline: number | null = null;
  let lifeBeforeRestart: string | null = null;
  let killDone = false;
  let bodyDeadline: number | null = null;

  for (;;) {
    await clock.sleep(MINUTE_MS);
    const now = clock.nowMs();

    const restartDue =
      !restartDone && input.plannedRestartAtMs !== null && now >= input.plannedRestartAtMs;
    if (restartDue) {
      restartDone = true;
      lifeBeforeRestart = last?.lifeId ?? null;
      restartDeadline = now + RESTART_WAIT_MS;
      try {
        await supervisor.restartStack();
      } catch (err) {
        return abortWith('error', `restart failed: ${message(err)}`);
      }
    }

    let obs: Observation;
    try {
      obs = await sampler.observe(startMs);
    } catch (err) {
      // One bad minute is a gap in status.log; only a run of failures in a row ends the run.
      samplerFailures++;
      if (samplerFailures >= MAX_SAMPLER_FAILURES)
        return abortWith(
          'error',
          `the sampler failed ${samplerFailures} times in a row: ${message(err)}`,
        );
      appendStatus(
        files,
        paths.status,
        harnessLine(
          last,
          now,
          startMs,
          'sampler_failed',
          `${message(err)} (failure ${samplerFailures} of ${MAX_SAMPLER_FAILURES})`,
        ),
      );
      continue;
    }
    samplerFailures = 0;
    last = obs;
    appendStatus(files, paths.status, statusLine(obs, minuteOf(now, startMs)));
    if (restartDue) {
      appendStatus(
        files,
        paths.status,
        harnessLine(obs, now, startMs, 'restart_stack', 'planned stack restart'),
      );
    }
    history.push(toSample(obs));

    const fired = evaluateAbort(history, now, deps.criteria);
    if (fired !== null) {
      return fired.rule === 'life_ended'
        ? endWithLife(fired.rule, fired.reason)
        : abortWith(fired.rule, fired.reason);
    }
    if (deps.stopRequested?.())
      return abortWith('operator_stop', 'a stop was requested from another shell');

    if (restartDeadline !== null) {
      const recovered =
        obs.lifeId === lifeBeforeRestart &&
        obs.alive.animus &&
        obs.alive['lantern-local'] &&
        obs.alive.body;
      if (recovered) restartDeadline = null;
      else if (now >= restartDeadline)
        return abortWith(
          'restart_not_recovered',
          'the stack did not come back on the same life id',
        );
    }

    // Checked before the kill below: the sample of the kill tick was taken before the kill, so it must not count.
    if (bodyDeadline !== null) {
      if (obs.alive.body) bodyDeadline = null;
      else if (now >= bodyDeadline)
        return abortWith('body_not_recovered', 'the Body did not reconnect after the kill');
    }

    const killDue =
      !killDone &&
      input.bodyKillAtMs !== null &&
      now >= input.bodyKillAtMs &&
      obs.activeIntentId !== null;
    if (killDue) {
      killDone = true;
      bodyKills++;
      try {
        await supervisor.restartBody();
      } catch (err) {
        return abortWith('error', `body kill failed: ${message(err)}`);
      }
      bodyDeadline = now + BODY_WAIT_MS;
      appendStatus(
        files,
        paths.status,
        harnessLine(obs, now, startMs, 'body_kill', `intent ${obs.activeIntentId}`),
      );
    }

    if (now >= endMs) break;
  }

  const endedAt = clock.nowMs();
  await report(endedAt);
  appendStatus(files, paths.status, harnessLine(last, endedAt, startMs, 'end', 'completed'));
  return { status: 'completed', bodyKills, reportFailed };
}
