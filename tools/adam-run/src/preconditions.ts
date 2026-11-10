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
  PROFILE_TIER,
  type Profile,
  tagKey,
} from './manifest.ts';
import { type MindLife, SHARD_PATH, type ShardEdit } from './shard-edit.ts';
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
  /** The named volumes the running Paper container mounts at its world path, or null when no Paper container runs. */
  paperVolumes: string[] | null;
  /** The value of GELDAR_WORLD_VOLUME in the environment, or undefined when it is unset. */
  worldVolumeEnv: string | undefined;
  /** The life id the run would use. */
  lifeId: string;
  /** The thoughts and intents rows the life already holds, or null when Postgres could not be read. */
  lifeRows: LifeRows | null;
  /** The Mind's life as `shards/phase0.yaml` names it now: the username, the agent tier and the run tier. */
  mind: MindLife;
  /** The secret files a start needs that are missing or unreadable, as paths. Absent means none were checked. */
  secretsMissing?: string[];
}

export interface LifeRows {
  thoughts: number;
  intents: number;
}

export type Verdict = { ok: true } | { ok: false; missing: string[] };

/**
 * A run's life must hold no journal rows yet: decision 0064 keeps every row, so a life that has any is used up and the
 * run needs a fresh life id.
 */
function freshLifeProblems(f: PreconditionFacts): string[] {
  if (f.lifeRows === null) {
    return [
      `life ${f.lifeId}: Postgres could not be read to check the life is unused; start the stack and retry`,
    ];
  }
  const { thoughts, intents } = f.lifeRows;
  if (thoughts === 0 && intents === 0) return [];
  return [
    `life ${f.lifeId} already has ${thoughts} thoughts and ${intents} intents; a fresh life id is needed (decision 0064; journals are never deleted)`,
  ];
}

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

/**
 * The 32B and 8B runs write to the volume that `prepare-volume` made. Paper has been writing to it since the stack was
 * recreated, so start checks that the volume is labelled and that the running Paper mounts exactly it. The emptiness
 * check belongs to `prepare-volume`, which makes the volume.
 */
function worldVolumeProblems(f: PreconditionFacts): string[] {
  if (f.prepared === null) {
    return ['world volume: the run folder holds no prepared volume; run prepare-volume first'];
  }
  const name = f.prepared.worldVolume;
  const recreate = `recreate the compose stack with GELDAR_WORLD_VOLUME=${name}`;
  const problems: string[] = [];
  if (f.volume === null || !f.volume.exists) {
    problems.push(`world volume ${name} does not exist; run prepare-volume again`);
  } else if (!f.volume.labelled) {
    problems.push(`world volume ${name} is not labelled by compose`);
  }
  if (f.paperVolumes === null) {
    problems.push(`Paper is not running; ${recreate}, then wait for Paper`);
  } else if (f.paperVolumes.length !== 1 || f.paperVolumes[0] !== name) {
    const mounted = f.paperVolumes.length === 0 ? 'no volume' : f.paperVolumes.join(', ');
    problems.push(`Paper mounts ${mounted} at /data, not ${name}; ${recreate}`);
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
  for (const path of f.secretsMissing ?? []) {
    missing.push(
      `secret file ${path} is missing or unreadable; the run worktree needs compose/secrets (a junction to the checkout that holds the secrets)`,
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
  missing.push(...freshLifeProblems(f));
  // The Mind runs the shard file's life and tier: a run whose profile names another one would run the wrong model.
  const select = `adam select --model ${f.profile === 'smoke' ? 'smoke' : PROFILE_TIER[f.profile]}`;
  if (f.mind.username !== LIFE_ID[f.profile]) {
    missing.push(
      `shard life: profile ${f.profile} runs ${LIFE_ID[f.profile]}, but ${SHARD_PATH} selects ${f.mind.username ?? 'no life'}; run ${select}`,
    );
  }
  if (f.mind.tier !== PROFILE_TIER[f.profile]) {
    missing.push(
      `shard tier: profile ${f.profile} runs the ${PROFILE_TIER[f.profile]} tier, but ${SHARD_PATH} sets ${f.mind.tier ?? 'none'}; run ${select}`,
    );
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
