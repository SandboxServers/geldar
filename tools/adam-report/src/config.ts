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

/** Parses manifest.json (W6-13's format, defined here). Throws on a missing or malformed field. */
export function parseManifest(text: string): Manifest {
  const raw = JSON.parse(text) as Raw;
  const tags = raw.model_tags;
  if (!Array.isArray(tags)) throw new Error('manifest: model_tags must be an array');
  const restarts = raw.restarts ?? [];
  if (!Array.isArray(restarts)) throw new Error('manifest: restarts must be an array');
  const tps = raw.tps_target;
  if (typeof tps !== 'number') throw new Error('manifest: tps_target must be a number');
  return {
    runId: str(raw, 'run_id'),
    lifeId: str(raw, 'life_id'),
    worldSeed: str(raw, 'world_seed'),
    gitSha: str(raw, 'git_sha'),
    modelTags: tags.map((t: Raw) => ({ tag: str(t, 'tag'), digest: str(t, 'digest') })),
    shardConfigHash: str(raw, 'shard_config_hash'),
    startTimeMs: time(raw, 'start_time'),
    restarts: restarts.map((r: Raw) => {
      const kind = str(r, 'kind');
      if (kind !== 'planned' && kind !== 'body')
        throw new Error('manifest: restart kind must be planned or body');
      return { atMs: time(r, 'at'), kind };
    }),
    tpsTarget: tps,
  };
}
