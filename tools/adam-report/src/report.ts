import { callsMeasure, latencyMeasure, outcomeHistogram } from './calls.ts';
import { continuityMeasure } from './continuity.ts';
import { intentByAction, intentMeasures, receiptMeasure, resumeMeasure } from './intents.ts';
import type { Snapshot } from './snapshot.ts';
import { survivalMeasure } from './survival.ts';
import { type Criteria, type Measure, PENDING } from './types.ts';

export const REPORT_SCHEMA = 'adam-run-report/1';

/** The rows and settings the report is computed from (see snapshot.ts). */
export type ReportInput = Snapshot;

export interface Report {
  schema: typeof REPORT_SCHEMA;
  runId: string;
  lifeId: string;
  /** The query window: the first and last thought of the life (ISO 8601, UTC). */
  window: { from: string; to: string; thoughtRows: number };
  manifest: {
    worldSeed: string;
    gitSha: string;
    modelTags: { tag: string; digest: string }[];
    shardConfigHash: string;
    startTime: string;
    tpsTarget: number;
    restarts: { at: string; kind: string }[];
  };
  /** One entry per exit criterion, in the order the spec and decision 0061 state them. */
  measures: Measure[];
  outcomes: Record<string, number>;
}

/** The model floor is the owner's recorded verdict; it is echoed, never computed here. */
function modelFloor(criteria: Criteria): Measure {
  const base = {
    id: 'model_floor',
    title: 'Model floor (smallest model that passed)',
    window: 'criteria file',
  };
  if (criteria.modelFloorVerdict === null)
    return { ...base, verdict: 'UNKNOWN', values: {}, note: PENDING };
  return {
    ...base,
    verdict: 'PASS',
    values: { floor: criteria.modelFloorVerdict },
    note: 'recorded by the owner in the criteria file',
  };
}

/** The run report: every measure, computed from the rows. Pure: no clock, no I/O. */
export function computeReport(input: ReportInput): Report {
  const { manifest, criteria, data } = input;
  const { thoughts, intents, actions, receipts, events } = data;
  const times = thoughts.map((t) => t.atMs);
  const from = times.length === 0 ? '' : new Date(Math.min(...times)).toISOString();
  const to = times.length === 0 ? '' : new Date(Math.max(...times)).toISOString();
  const windowText = `${from} to ${to} (${thoughts.length} thought rows)`;
  const intentMap = intentByAction(actions);
  const bodyRestarts = manifest.restarts.filter((r) => r.kind === 'body').length;
  const survival =
    criteria.survivalDays === null
      ? {
          id: 'survival',
          title: 'Survival',
          verdict: 'UNKNOWN' as const,
          window: '',
          values: {},
          note: PENDING,
        }
      : survivalMeasure({
          thoughts,
          events,
          actions,
          receipts,
          days: criteria.survivalDays,
          deathFailsRun: criteria.deathFailsRun ?? true,
        });
  const measures: Measure[] = [
    survival,
    ...intentMeasures(intents, thoughts, criteria.intentsWithoutCallMin, windowText),
    receiptMeasure(actions, receipts, windowText),
    resumeMeasure(intents, actions, bodyRestarts, windowText),
    modelFloor(criteria),
    callsMeasure({ thoughts, receipts, intentByAction: intentMap }, windowText),
    latencyMeasure(
      { thoughts, p95MaxMs: criteria.latencyP95MaxMs, hardLimitMs: criteria.latencyHardLimitMs },
      windowText,
    ),
    continuityMeasure(
      {
        thoughts,
        restarts: manifest.restarts,
        continuousHours: criteria.continuousHours,
        continuousWorldDays: criteria.continuousWorldDays,
        maxGapSeconds: criteria.maxGapSeconds,
      },
      windowText,
    ),
  ];
  return {
    schema: REPORT_SCHEMA,
    runId: manifest.runId,
    lifeId: manifest.lifeId,
    window: { from, to, thoughtRows: thoughts.length },
    manifest: {
      worldSeed: manifest.worldSeed,
      gitSha: manifest.gitSha,
      modelTags: [...manifest.modelTags].sort((a, b) =>
        a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0,
      ),
      shardConfigHash: manifest.shardConfigHash,
      startTime: new Date(manifest.startTimeMs).toISOString(),
      tpsTarget: manifest.tpsTarget,
      restarts: manifest.restarts
        .map((r) => ({ at: new Date(r.atMs).toISOString(), kind: r.kind }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    },
    measures,
    outcomes: outcomeHistogram(thoughts),
  };
}
