// What eventsink main starts, read from the environment (card AN-12b). Unset is the old behaviour: no state
// service, no outbox publisher, XP off in the writer, and GELDAR_PROFICIENCY_THRESHOLDS not even read.
import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
import type { XpWriting } from './writer.ts';
import { type XpThresholds, xpEnabled, xpThresholds } from './xp/xp-config.ts';

export interface SinkPlan {
  /** GELDAR_SHARD, or undefined. Unset and blank both mean no state service and no outbox publisher. */
  shard: string | undefined;
  /** The writer's XP option. Thresholds are the defaults unless XP is on. */
  xp: XpWriting;
}

export interface Stoppable {
  stop(): Promise<void>;
}

/** What startShardServices starts. The state service always uses psyche's defaults (AN-11a): the Body checks levels with them. */
export interface ShardServiceStarters {
  startState(shard: string): Stoppable;
  startOutbox(shard: string): Stoppable;
}

export function sinkPlan(env: NodeJS.ProcessEnv): SinkPlan {
  const raw = env.GELDAR_SHARD?.trim();
  const shard = raw === undefined || raw === '' ? undefined : raw;
  if (!xpEnabled(env)) return { shard, xp: { enabled: false, thresholds: DEFAULT_THRESHOLDS } };
  const thresholds: XpThresholds = xpThresholds(env);
  if (shard !== undefined && !sameAsDefaults(thresholds)) {
    throw new RangeError(
      'GELDAR_PROFICIENCY_THRESHOLDS must be unset while GELDAR_SHARD runs the state service: the Body checks levels with the defaults',
    );
  }
  return { shard, xp: { enabled: true, thresholds } };
}

function sameAsDefaults(thresholds: XpThresholds): boolean {
  return thresholds.every((value, i) => value === DEFAULT_THRESHOLDS[i]);
}

/** Starts the state service and the outbox publisher when the plan names a shard; with no shard it starts nothing. */
export function startShardServices(plan: SinkPlan, starters: ShardServiceStarters): Stoppable[] {
  if (plan.shard === undefined) return [];
  const state = starters.startState(plan.shard);
  return [state, starters.startOutbox(plan.shard)];
}
