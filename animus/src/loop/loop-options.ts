/**
 * The thinking loop's options: what it reads from the loaded configuration and the build.
 */
import type { AnimusConfig, JobSettings } from '../config.ts';
import type { LoopVersions } from './journal-row.ts';
/** What the loop reads from the configuration and the build. */
export interface LoopOptions {
  /** The life the loop thinks for. */
  lifeId: string;
  /** The model tag, fixed for the life. */
  model: string;
  /** The pinned model configuration, recorded on every thought (at most 256 characters). */
  modelConfig: string;
  versions: LoopVersions;
  thought: JobSettings;
  /** `mind.plan.expires_after_ticks`. */
  expiresAfterTicks: number;
  /** The shard's `tick_rate`: world ticks a second. Turns the plan's expiry into wall-clock time. */
  tickRate: number;
  /** How many recent thoughts the prompt gets. */
  workingWindow: number;
  /** How many episodic memories to retrieve. */
  episodicTopK: number;
  /** How long to keep asking for a snapshot while the Body is not up; absent means once. */
  snapshotRetryMs?: number;
  /** How long a `no_thinker` call waits for a Thinker before the fallback; absent means not at all. */
  thinkerWaitMs?: number;
  /** How long the memory load may take before the thought fails; absent means no limit. */
  memoryTimeoutMs?: number;
  /** The longest one cycle step may wait on a dependency; absent means `STEP_TIMEOUT_MS`. */
  stepTimeoutMs?: number;
}

/** The loop's options from the loaded configuration; `bodyVersion` is the Body build's version. */
export function loopOptionsFromConfig(config: AnimusConfig, versions: LoopVersions): LoopOptions {
  const model = config.models[config.runTier]?.[0];
  if (model === undefined) throw new Error(`no model for the run tier ${config.runTier}`);
  const pin = config.modelPins[model];
  if (pin === undefined) throw new Error(`no model pin for ${model}`);
  const modelConfig =
    `${model}@${pin.digest};num_ctx=${pin.numCtx};temperature=${config.thought.temperature}`.slice(
      0,
      256,
    );
  return {
    lifeId: config.agent.username,
    model,
    modelConfig,
    versions,
    thought: config.thought,
    expiresAfterTicks: config.plan.expiresAfterTicks,
    tickRate: config.tickRate,
    workingWindow: config.memory.workingWindow,
    episodicTopK: config.memory.episodicTopK,
    snapshotRetryMs: config.mind.snapshotRetryS * 1000,
    thinkerWaitMs: config.mind.thinkerWaitS * 1000,
    memoryTimeoutMs: config.mind.memoryTimeoutS * 1000,
  };
}
