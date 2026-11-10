/**
 * The gate before `start`. It takes the facts the CLI collected (git, the benchmark gate file, the pins, Ollama,
 * the prepared world volume) and returns every missing item, each with what to do about it. Pure.
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
import { SHARD_PATH, type ShardEdit } from './shard-edit.ts';
import type { PreparedRecord, VolumeState } from './world-volume.ts';

export interface PreconditionFacts {
  profile: Profile;
  headSha: string;
  /** Changed or untracked paths in the working tree, other than `shards/phase0.yaml`. Empty when none. */
  otherChanges: string[];
  /** What changed in `shards/phase0.yaml`: nothing, the tier select's three keys, or something a start refuses. */
  shardEdit: ShardEdit;
  /** The newest `bench-results/*.json` and its text, or null when the folder holds no result. */
  bench: BenchFile | null;
  pins: PinnedModel[];
  /** The digest Ollama reports for each tag, or null when the tag is not pulled. */
  observedDigests: Record<string, string | null>;
  /** The models Ollama has loaded now (`ollama ps`). */
  loadedModels: string[];
  /** The prepared record in the run folder's manifest.json, or null when the folder holds none. */
  prepared: PreparedRecord | null;
  /** The recorded volume's state now, or null when there is no record to inspect. */
  volume: VolumeState | null;
  /** The value of GELDAR_WORLD_VOLUME in the environment, or undefined when it is unset. */
  worldVolumeEnv: string | undefined;
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

/** The 32B and 8B runs write to the volume that `prepare-volume` made: it must be the recorded, empty, unused one. */
function worldVolumeProblems(f: PreconditionFacts): string[] {
  if (f.prepared === null) {
    return ['world volume: the run folder holds no prepared volume; run prepare-volume first'];
  }
  const name = f.prepared.worldVolume;
  const problems: string[] = [];
  if (f.volume === null || !f.volume.exists) {
    problems.push(`world volume ${name} does not exist; run prepare-volume again`);
  } else {
    if (!f.volume.labelled) problems.push(`world volume ${name} is not labelled by compose`);
    if (!f.volume.empty) problems.push(`world volume ${name} is not empty; use a new run id`);
    if (f.volume.usedBy.length > 0) {
      problems.push(`world volume ${name} is mounted by ${f.volume.usedBy.length} container(s)`);
    }
  }
  if (f.worldVolumeEnv !== name) {
    problems.push(
      `GELDAR_WORLD_VOLUME is ${f.worldVolumeEnv ?? 'unset'}, not ${name}; set it to ${name}`,
    );
  }
  return problems;
}

export function checkPreconditions(f: PreconditionFacts): Verdict {
  const missing: string[] = [];
  if (f.otherChanges.length > 0) {
    missing.push(
      `clean tree: uncommitted changes in ${f.otherChanges.join(', ')}; commit or remove them`,
    );
  }
  if (f.shardEdit.kind === 'refused') {
    missing.push(
      `clean tree: ${SHARD_PATH} is changed beyond the tier select (${f.shardEdit.reason}${f.shardEdit.keys.length > 0 ? `: ${f.shardEdit.keys.join(', ')}` : ''}); only the tier select may change it`,
    );
  }
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
  if (f.profile !== 'smoke') missing.push(...worldVolumeProblems(f));
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
