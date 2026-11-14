// The stray sweep (C7-03c1). It lists the Body containers on the node and logs one line for each whose name is
// not on the roster. It is REPORT ONLY: it never stops or removes a container. The operator reap path is a
// later card (C7-03c4). The sweep runs once at start and then every interval, and never throws out of its timer.
import type { RosterPort } from './roster.ts';

export interface SweepBody {
  /** The lower-cased container name, from the Body label. */
  name: string;
  /** The owner the Body was created under, from its owner label. */
  owner: string;
  running: boolean;
}

export interface SweepEngine {
  bodies(): Promise<SweepBody[]>;
}

export interface SweepDeps {
  engine: SweepEngine;
  roster: RosterPort;
  /** Names whose stop timed out and is not confirmed (the helper's set). A listed one still running is logged. */
  stopTimeouts?: ReadonlySet<string>;
  audit(line: string): void;
}

export const SWEEP_FAILED = 'body-helper sweep failed';

/** One pass. Returns the number of strays it logged; a failed listing logs SWEEP_FAILED and returns -1. */
export async function sweepStrays(deps: SweepDeps): Promise<number> {
  let bodies: SweepBody[];
  try {
    bodies = await deps.engine.bodies();
  } catch {
    deps.audit(SWEEP_FAILED);
    return -1;
  }
  let strays = 0;
  for (const body of bodies) {
    let onRoster: string | null;
    try {
      // The roster key is lower-case; a container name may not be. Compare on the lower-case name.
      onRoster = await deps.roster.displayName(body.owner, body.name.toLowerCase());
    } catch {
      deps.audit(SWEEP_FAILED);
      return -1;
    }
    if (onRoster === null) {
      strays++;
      deps.audit(`body-helper stray name=${body.name} outcome=report_only`);
    }
  }
  // A stop that timed out and is still listed as running: one stable line per pass until the stop lands.
  for (const name of deps.stopTimeouts ?? []) {
    if (bodies.some((body) => body.running && body.name === name)) {
      deps.audit(`body-helper stop_timed_out name=${name} outcome=report_only`);
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
