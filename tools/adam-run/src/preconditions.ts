/**
 * The gate before `start`. It takes the facts the CLI collected (git, the benchmark gate file, the pins, Ollama,
 * the fresh-volume marker) and returns every missing item, each with what to do about it. Pure.
 */
import { type BenchFile, checkBench } from './bench-gate.ts';
import {
  digestsMatch,
  LIFE_ID,
  type PinnedModel,
  PROFILE_MODEL,
  type Profile,
  tagKey,
} from './manifest.ts';

export interface PreconditionFacts {
  profile: Profile;
  headSha: string;
  cleanTree: boolean;
  /** The newest `bench-results/*.json` and its text, or null when the folder holds no result. */
  bench: BenchFile | null;
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

/** The digest Ollama reports for a pin's tag, matching `tag` and `tag:latest` alike. */
function observedFor(observed: Record<string, string | null>, tag: string): string | null {
  const entry = Object.entries(observed).find(([name]) => tagKey(name) === tagKey(tag));
  return entry?.[1] ?? null;
}

/** The models that may stay loaded: the profile's chat model, and the CPU-only embedding model. */
export function allowedLoaded(profile: Profile, pins: PinnedModel[]): string[] {
  const embedding = pins.find(
    (p) => p.tag !== PROFILE_MODEL['32b'] && p.tag !== PROFILE_MODEL['8b'],
  );
  return [PROFILE_MODEL[profile], ...(embedding ? [embedding.tag] : [])];
}

export function checkPreconditions(f: PreconditionFacts): Verdict {
  const missing: string[] = [];
  if (!f.cleanTree)
    missing.push('clean tree: the working tree has uncommitted changes; commit or remove them');
  const gate = checkBench(f.bench, f.headSha);
  if (!gate.ok) missing.push(...gate.problems);
  for (const pin of f.pins) {
    const observed = observedFor(f.observedDigests, pin.tag);
    if (observed === null) {
      missing.push(`model pin ${pin.tag}: Ollama does not have it; pull it at the pinned digest`);
    } else if (!digestsMatch(observed, pin.digest)) {
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
    if (!allowed.some((a) => tagKey(a) === tagKey(loaded))) {
      missing.push(
        `GPU: ${loaded} is loaded in Ollama; unload it (expected only ${allowed.join(', ')})`,
      );
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
