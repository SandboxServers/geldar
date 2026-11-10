import { parse } from 'yaml';
import type { Criteria, Manifest } from './types.ts';

const CRITERIA_KEYS = [
  'survival_days',
  'death_fails_run',
  'latency_p95_max_ms',
  'latency_hard_limit_ms',
  'continuous_hours',
  'continuous_world_days',
  'max_gap_seconds',
  'intents_without_call_min',
  'model_floor_verdict',
] as const;

type Raw = Record<string, unknown>;

function numberOrNull(raw: Raw, key: string): number | null {
  const v = raw[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    throw new Error(`criteria: ${key} must be a number or null`);
  return v;
}

/** Parses criteria.yaml. An unknown key is an error, so a typo cannot silently leave a threshold null. */
export function parseCriteria(text: string): Criteria {
  const raw = parse(text) as Raw | null;
  if (raw === null || typeof raw !== 'object')
    throw new Error('criteria: the file must be a mapping');
  for (const key of Object.keys(raw)) {
    if (!(CRITERIA_KEYS as readonly string[]).includes(key))
      throw new Error(`criteria: unknown key ${key}`);
  }
  const floor = raw.model_floor_verdict;
  if (floor !== null && floor !== undefined && typeof floor !== 'string') {
    throw new Error('criteria: model_floor_verdict must be a string or null');
  }
  const death = raw.death_fails_run;
  if (death !== null && death !== undefined && typeof death !== 'boolean') {
    throw new Error('criteria: death_fails_run must be a boolean or null');
  }
  return {
    survivalDays: numberOrNull(raw, 'survival_days'),
    deathFailsRun: typeof death === 'boolean' ? death : null,
    latencyP95MaxMs: numberOrNull(raw, 'latency_p95_max_ms'),
    latencyHardLimitMs: numberOrNull(raw, 'latency_hard_limit_ms'),
    continuousHours: numberOrNull(raw, 'continuous_hours'),
    continuousWorldDays: numberOrNull(raw, 'continuous_world_days'),
    maxGapSeconds: numberOrNull(raw, 'max_gap_seconds'),
    intentsWithoutCallMin: numberOrNull(raw, 'intents_without_call_min'),
    modelFloorVerdict: typeof floor === 'string' ? floor : null,
  };
}

function str(raw: Raw, key: string): string {
  const v = raw[key];
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`manifest: ${key} must be a non-empty string`);
  return v;
}

function time(raw: Raw, key: string): number {
  const ms = Date.parse(str(raw, key));
  if (Number.isNaN(ms)) throw new Error(`manifest: ${key} must be an ISO 8601 time`);
  return ms;
}

/** The schema adam-run's buildManifest writes (tools/adam-run/src/manifest.ts). */
export const MANIFEST_SCHEMA = 'adam-run-manifest/1';

/**
 * Parses the manifest.json that `adam-run` writes. adam-run is the writer; this reader follows its field names.
 * adam-run records no restart here, so `restarts` is empty: `planned_restart_at` is a plan, not a restart record.
 * The restarts are read from status.log by cli.ts (status-run.ts).
 * Throws on a missing or malformed field, and on any other schema.
 */
export function parseManifest(text: string): Manifest {
  const raw = JSON.parse(text) as Raw;
  if (raw.schema !== MANIFEST_SCHEMA)
    throw new Error(`manifest: schema must be ${MANIFEST_SCHEMA}`);
  const git = raw.git as Raw | null | undefined;
  if (typeof git !== 'object' || git === null) throw new Error('manifest: git must be an object');
  const pins = raw.model_pins;
  if (!Array.isArray(pins)) throw new Error('manifest: model_pins must be an array');
  const seed = raw.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed))
    throw new Error('manifest: seed must be an integer');
  const tps = raw.tps_target;
  if (typeof tps !== 'number') throw new Error('manifest: tps_target must be a number');
  return {
    runId: str(raw, 'run_id'),
    lifeId: str(raw, 'life_id'),
    worldSeed: String(seed),
    gitSha: str(git, 'sha'),
    modelTags: pins.map((p: Raw) => ({ tag: str(p, 'tag'), digest: str(p, 'pinned_digest') })),
    shardConfigHash: str(raw, 'shard_config_sha256'),
    startTimeMs: time(raw, 'started_at'),
    restarts: [],
    tpsTarget: tps,
  };
}
