/**
 * The run manifest (`manifest.json`): what the run was made of. It holds only values the protocol computes or reads
 * from a committed file (the git sha, the shard config bytes, the pins, the criteria file). It never holds an
 * environment value, a password, a token or a connection string.
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'yaml';
import type { BenchSummary } from './bench-gate.ts';
import type { FileStore } from './ports.ts';

export const PROFILES = ['32b', '8b', 'smoke'] as const;
export type Profile = (typeof PROFILES)[number];

/** The life each profile runs: a fresh life per exit run (decision 0051; decision 0064 names the lives). */
export const LIFE_ID: Record<Profile, string> = {
  '32b': 'ag_adam_03',
  '8b': 'ag_adam_04',
  smoke: 'ag_smoke_01',
};

/** The tier each profile's Mind runs on: the shard file's `mind.agent.tier` and `mind.run_tier` must say it. */
export const PROFILE_TIER: Record<Profile, 'strong' | 'fast'> = {
  '32b': 'strong',
  '8b': 'fast',
  smoke: 'fast',
};

/** The chat model each profile runs. The smoke run uses the fast model. */
export const PROFILE_MODEL: Record<Profile, string> = {
  '32b': 'qwen3:32b',
  '8b': 'qwen3:8b',
  smoke: 'qwen3:8b',
};

export const TPS_TARGET = 20;

export interface PinnedModel {
  tag: string;
  digest: string;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The hex part of a digest. Pins carry `sha256:<hex>`; Ollama's `/api/tags` gives bare `<hex>`. Both reduce to the
 * same lowercase hex, which is compared in full (never a prefix).
 */
export function digestHex(digest: string): string {
  return digest
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
}

export function digestsMatch(a: string, b: string): boolean {
  return digestHex(a) === digestHex(b);
}

/** A tag without its default `:latest`: Ollama lists `nomic-embed-text:latest` for the pin `nomic-embed-text`. */
export function tagKey(tag: string): string {
  return tag.endsWith(':latest') ? tag.slice(0, -':latest'.length) : tag;
}

/** The pins of `shards/phase0.yaml`: every `model_pins` entry, and the embedding model. Throws when a pin is missing. */
export function readPins(shardYaml: string): PinnedModel[] {
  const doc = parse(shardYaml) as Record<string, unknown> | null;
  const pins = doc?.model_pins;
  if (typeof pins !== 'object' || pins === null) {
    throw new Error('shards/phase0.yaml has no model_pins block');
  }
  const out: PinnedModel[] = [];
  for (const [tag, entry] of Object.entries(pins)) {
    const digest = (entry as { digest?: unknown } | null)?.digest;
    if (typeof digest !== 'string') throw new Error(`model_pins.${tag} has no digest`);
    out.push({ tag, digest });
  }
  const embedding = doc?.embedding as { model?: unknown; digest?: unknown } | undefined;
  if (typeof embedding?.model === 'string' && typeof embedding.digest === 'string') {
    out.push({ tag: embedding.model, digest: embedding.digest });
  }
  return out;
}

/** What `adam-cli select` changed in the shard file before the start, with the file's digest before and after. */
export interface ShardEditInput {
  changes: { key: string; from: string; to: string }[];
  sha256Before: string;
  sha256After: string;
}

export interface ManifestInput {
  runId: string;
  profile: Profile;
  seed: number;
  startedAt: string;
  plannedRestartAt: string | null;
  git: { sha: string; clean: boolean };
  shardConfigSha256: string;
  /** The select's edit of the shard file, or null when the file was not edited before the start. */
  shardEdit: ShardEditInput | null;
  pins: PinnedModel[];
  /** The digest Ollama reports for each tag, or null when the tag is not pulled. */
  observedDigests: Record<string, string | null>;
  /** The gate that passed: the bench file, its commit and the 20 TPS rows. Null when none was read. */
  bench: BenchSummary | null;
  criteriaSha256: string;
}

export interface ManifestBench {
  file: string;
  commit: string;
  tps20: { scenario: string; success_pct: number | null }[];
}

export interface ManifestPin {
  tag: string;
  pinned_digest: string;
  observed_digest: string | null;
  matches: boolean;
}

export interface ManifestShardEdit {
  changes: { key: string; from: string; to: string }[];
  sha256_before: string;
  sha256_after: string;
}

export interface Manifest {
  schema: 'adam-run-manifest/1';
  run_id: string;
  profile: Profile;
  life_id: string;
  seed: number;
  git: { sha: string; clean: boolean };
  shard_config_sha256: string;
  shard_edit: ManifestShardEdit | null;
  model_pins: ManifestPin[];
  bench: ManifestBench | null;
  criteria_sha256: string;
  tps_target: number;
  started_at: string;
  planned_restart_at: string | null;
}

export function buildManifest(input: ManifestInput): Manifest {
  return {
    schema: 'adam-run-manifest/1',
    run_id: input.runId,
    profile: input.profile,
    life_id: LIFE_ID[input.profile],
    seed: input.seed,
    git: { sha: input.git.sha, clean: input.git.clean },
    shard_config_sha256: input.shardConfigSha256,
    shard_edit:
      input.shardEdit === null
        ? null
        : {
            changes: input.shardEdit.changes.map((c) => ({ key: c.key, from: c.from, to: c.to })),
            sha256_before: input.shardEdit.sha256Before,
            sha256_after: input.shardEdit.sha256After,
          },
    model_pins: input.pins.map((pin) => {
      const observed = input.observedDigests[pin.tag] ?? null;
      return {
        tag: pin.tag,
        pinned_digest: pin.digest,
        observed_digest: observed,
        matches: observed === pin.digest,
      };
    }),
    bench:
      input.bench === null
        ? null
        : {
            file: input.bench.file,
            commit: input.bench.commit,
            tps20: input.bench.tps20.map((row) => ({
              scenario: row.scenario,
              success_pct: row.successPct,
            })),
          },
    criteria_sha256: input.criteriaSha256,
    tps_target: TPS_TARGET,
    started_at: input.startedAt,
    planned_restart_at: input.plannedRestartAt,
  };
}

export function writeManifest(store: FileStore, runDir: string, manifest: Manifest): void {
  store.write(posix.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
