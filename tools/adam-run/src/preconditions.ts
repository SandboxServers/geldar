/**
 * The gate before `start`. It takes the facts the CLI collected (git, the benchmark gate file, the pins, Ollama,
 * the fresh-volume marker) and returns every missing item, each with what to do about it. Pure.
 */
import { LIFE_ID, type PinnedModel, PROFILE_MODEL, type Profile } from './manifest.ts';

export interface GateRecord {
  sha: string;
  date: string;
  result: 'pass' | 'fail';
  rates: { tps: number; percent: number }[];
}

export interface PreconditionFacts {
  profile: Profile;
  headSha: string;
  cleanTree: boolean;
  /** The text of `.geldar/runs/benchmark-gate.json`, or null when the file is missing. */
  gateJson: string | null;
  pins: PinnedModel[];
  /** The digest Ollama reports for each tag, or null when the tag is not pulled. */
  observedDigests: Record<string, string | null>;
  /** The models Ollama has loaded now (`ollama ps`). */
  loadedModels: string[];
  /** The text of `fresh-volume.json` (8B profile only), or null when missing. */
  freshVolumeJson: string | null;
  /** The life id the run would use. */
  lifeId: string;
}

export type Verdict = { ok: true } | { ok: false; missing: string[] };

/** The models that may stay loaded: the profile's chat model, and the CPU-only embedding model. */
export function allowedLoaded(profile: Profile, pins: PinnedModel[]): string[] {
  const embedding = pins.find(
    (p) => p.tag !== PROFILE_MODEL['32b'] && p.tag !== PROFILE_MODEL['8b'],
  );
  return [PROFILE_MODEL[profile], ...(embedding ? [embedding.tag] : [])];
}

function gateProblems(gateJson: string | null, headSha: string): string[] {
  if (gateJson === null) {
    return [
      'benchmark gate: .geldar/runs/benchmark-gate.json is missing; run OPS-0 (the 20 TPS benchmark) first',
    ];
  }
  let gate: GateRecord;
  try {
    gate = JSON.parse(gateJson) as GateRecord;
  } catch {
    return ['benchmark gate: benchmark-gate.json is not valid JSON; re-run OPS-0'];
  }
  const problems: string[] = [];
  if (gate.result !== 'pass')
    problems.push(`benchmark gate: result is ${String(gate.result)}, not pass`);
  const at20 = gate.rates?.some((r) => r.tps === 20 && r.percent === 100) ?? false;
  if (!at20) problems.push('benchmark gate: no reading at 20 TPS with 100%');
  if (gate.sha !== headSha) {
    problems.push(
      `benchmark gate: recorded at ${gate.sha}, HEAD is ${headSha}; re-run OPS-0 at HEAD`,
    );
  }
  return problems;
}

export function checkPreconditions(f: PreconditionFacts): Verdict {
  const missing: string[] = [];
  if (!f.cleanTree)
    missing.push('clean tree: the working tree has uncommitted changes; commit or remove them');
  missing.push(...gateProblems(f.gateJson, f.headSha));
  for (const pin of f.pins) {
    const observed = f.observedDigests[pin.tag] ?? null;
    if (observed === null) {
      missing.push(`model pin ${pin.tag}: Ollama does not have it; pull it at the pinned digest`);
    } else if (observed !== pin.digest) {
      missing.push(
        `model pin ${pin.tag}: Ollama reports ${observed}, shards/phase0.yaml pins ${pin.digest}`,
      );
    }
  }
  if (f.lifeId !== LIFE_ID[f.profile]) {
    missing.push(`life id: profile ${f.profile} runs ${LIFE_ID[f.profile]}, not ${f.lifeId}`);
  }
  if (f.profile === '8b' && f.freshVolumeJson === null) {
    missing.push(
      'fresh world volume: fresh-volume.json is missing; create the 8B world volume first',
    );
  }
  const allowed = allowedLoaded(f.profile, f.pins);
  for (const loaded of f.loadedModels) {
    if (!allowed.includes(loaded)) {
      missing.push(
        `GPU: ${loaded} is loaded in Ollama; unload it (expected only ${allowed.join(', ')})`,
      );
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
