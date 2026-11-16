// The stray sweep (C7-03c1, BH-6). It lists the Body containers on the node and logs one line for each whose name is
// not on the roster. It removes nothing unless `removal` is set (managed Bodies on): then it removes a managed Body
// whose roster row is gone after exit 78 on two consecutive passes, its whitelist entry first, then the container.
// The sweep runs once at start and then every interval, and never throws out of its timer.

import type { RosterPort } from './roster.ts';
import type { ContainerState } from './service.ts';

/** The exit code a managed Body leaves with when its roster row is gone (golem NO_HOST_CONFIG_EXIT). */
export const ORPHAN_EXIT_CODE = 78;

export interface SweepBody {
  /** The lower-cased container name, from the Body label. */
  name: string;
  /** The owner the Body was created under, from its owner label. */
  owner: string;
  running: boolean;
}

export interface SweepEngine {
  bodies(): Promise<SweepBody[]>;
  /** A fresh inspect of one Body: its id, exit code and managed and life labels. Null when absent. */
  inspect(name: string): Promise<ContainerState | null>;
  remove(id: string): Promise<void>;
}

/** The BH-6 removal: the whitelist remove one-shot (BH-5b runRemove) and the container removal. */
export interface SweepRemoval {
  /** Runs the remove one-shot for a life id; its exit code, or -1 when it could not run. */
  removeLife(lifeId: string): Promise<number>;
  /** The names that met every condition on the previous pass. Owned by the caller; only a consecutive agreement removes. */
  seen: Set<string>;
}

export interface SweepDeps {
  engine: SweepEngine;
  roster: RosterPort;
  /** Names whose stop timed out and is not confirmed (the helper's set). A listed one still running is logged. */
  stopTimeouts?: ReadonlySet<string>;
  /** Names of a late start the helper could not remove (the helper's set). A listed one still running is logged. */
  orphanStarts?: ReadonlySet<string>;
  /** Set only when managed Bodies are on. Absent: the sweep reports and removes nothing. */
  removal?: SweepRemoval | undefined;
  audit(line: string): void;
}

export const SWEEP_FAILED = 'body-helper sweep failed';

type RemoveOutcome = 'removed' | 'failed' | 'waiting' | 'skipped';

// One candidate on one pass. Any doubt (a read that throws, a null container, a label that is not the managed shape)
// is `skipped`: nothing is removed and the name is not carried to the next pass.
async function removeIfConfirmed(
  deps: SweepDeps,
  removal: SweepRemoval,
  body: SweepBody,
  marked: Set<string>,
): Promise<RemoveOutcome> {
  let state: ContainerState | null;
  try {
    state = await deps.engine.inspect(body.name);
  } catch {
    return 'skipped';
  }
  if (
    state === null ||
    state.helperBody !== true ||
    state.managed !== true ||
    typeof state.lifeId !== 'string' ||
    state.exitCode !== ORPHAN_EXIT_CODE
  ) {
    return 'skipped';
  }
  // The first pass that meets every condition only marks the name: the second consecutive pass removes it.
  if (!removal.seen.has(body.name)) {
    marked.add(body.name);
    return 'waiting';
  }
  // The whitelist entry goes first. A failed remove keeps the container and is retried on the next pass.
  const code = await removal.removeLife(state.lifeId).catch(() => -1);
  if (code !== 0) {
    deps.audit(`body-helper orphan_removal_failed name=${body.name} outcome=failed`);
    marked.add(body.name);
    return 'failed';
  }
  try {
    await deps.engine.remove(state.id);
  } catch {
    deps.audit(`body-helper orphan_removal_failed name=${body.name} outcome=failed`);
    marked.add(body.name);
    return 'failed';
  }
  deps.audit(`body-helper orphan_removed name=${body.name} outcome=removed`);
  return 'removed';
}

/** One pass. Returns the number of strays it left in place; a failed read logs SWEEP_FAILED and returns -1. */
export async function sweepStrays(deps: SweepDeps): Promise<number> {
  const removal = deps.removal;
  let bodies: SweepBody[];
  try {
    bodies = await deps.engine.bodies();
  } catch {
    deps.audit(SWEEP_FAILED);
    removal?.seen.clear();
    return -1;
  }
  let strays = 0;
  const marked = new Set<string>();
  for (const body of bodies) {
    let onRoster: string | null;
    try {
      // The roster key is lower-case; a container name may not be. Compare on the lower-case name.
      onRoster = await deps.roster.displayName(body.owner, body.name.toLowerCase());
    } catch {
      // A roster read error never counts as a missing row: the pass aborts and nothing carries over.
      deps.audit(SWEEP_FAILED);
      removal?.seen.clear();
      return -1;
    }
    if (onRoster !== null) continue;
    const outcome = removal ? await removeIfConfirmed(deps, removal, body, marked) : 'skipped';
    if (outcome === 'removed') continue;
    strays++;
    if (outcome !== 'failed') deps.audit(`body-helper stray name=${body.name} outcome=report_only`);
  }
  if (removal) {
    removal.seen.clear();
    for (const name of marked) removal.seen.add(name);
  }
  // A stop that timed out and is still listed as running: one stable line per pass until the stop lands.
  for (const name of deps.stopTimeouts ?? []) {
    if (bodies.some((body) => body.running && body.name === name)) {
      deps.audit(`body-helper stop_timed_out name=${name} outcome=report_only`);
    }
  }
  // A late start that could not be undone and still runs: one stable line per pass until it is removed.
  for (const name of deps.orphanStarts ?? []) {
    if (bodies.some((body) => body.running && body.name === name)) {
      deps.audit(`body-helper late_start_orphan name=${name} outcome=report_only`);
    }
  }
  return strays;
}

/** Runs one pass now and then every minutes. Returns the function that stops the timer. */
export function startSweep(deps: SweepDeps, minutes: number): () => void {
  const pass = () => {
    void sweepStrays(deps);
  };
  pass();
  const timer = setInterval(pass, minutes * 60_000);
  return () => clearInterval(timer);
}
