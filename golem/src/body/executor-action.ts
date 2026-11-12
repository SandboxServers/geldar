import type { ActionRecord, Receipt, Thought } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import type { ActionRun } from '../actions/registry.ts';
import { receiptIdFor } from './derived-id.ts';
import type { ActionReport, PlanEnvelope } from './executor.ts';
import { ActionBusyError, type BodyRuntime } from './runtime.ts';

/** Longest wall wait (at time scale 1) for a busy reflex before a plan's action starts anyway. */
const REFLEX_IDLE_MS = 10_000;

/**
 * Waits for a busy reflex to end, at most `REFLEX_IDLE_MS` (scaled); a stuck reflex is logged, not
 * obeyed forever. Returns true when the wait gave up, so the caller does not wait for it again.
 */
export async function waitForReflexIdle(runtime: BodyRuntime): Promise<boolean> {
  const runner = runtime.reflexRunner;
  if (!runner.busy) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = REFLEX_IDLE_MS * runtime.timeScale;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), limit);
  });
  const timedOut = await Promise.race([runner.idle().then(() => false), expired]);
  clearTimeout(timer);
  if (timedOut)
    console.warn(
      `a reflex is still running after ${limit} ms; the plan's next action starts anyway`,
    );
  return timedOut;
}

/**
 * The failed run for a runtime that threw. An action that finds the slot taken is `busy` (the agent
 * should wait); any other throw is `internal`, and its message and stack go to the body log so the
 * next `internal` can be diagnosed. The detail names no action: the slot's holder may be a reflex.
 */
function thrownRun(error: unknown): ActionRun {
  if (error instanceof ActionBusyError) {
    return {
      state: 'failed',
      result: {
        status: 'failed',
        reason: 'busy',
        message: errorText(error),
        latency_ms: 0,
        world_ticks: null,
        detail: {},
      },
    };
  }
  const trace = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`action failed inside the body: ${trace}`);
  return {
    state: 'failed',
    result: {
      status: 'failed',
      reason: 'internal',
      message: errorText(error),
      latency_ms: 0,
      world_ticks: null,
      detail: {},
    },
  };
}

/**
 * Runs one immediate action of a plan through the runtime and records it: accepted, running,
 * then the final state with its receipt, all to the runtime's sink. Never throws; a handler that
 * throws becomes a failed action.
 */
export async function runPlanAction(
  runtime: BodyRuntime,
  now: () => Date,
  action: NonNullable<Thought['actions']>[number],
  actionId: string,
  sequence: number,
  plan: PlanEnvelope,
): Promise<ActionReport> {
  const sink = runtime.sink;
  const record: ActionRecord = {
    action_id: actionId,
    intent_id: null,
    life_id: plan.lifeId,
    body_generation: plan.bodyGeneration,
    sequence,
    source_snapshot_id: plan.sourceSnapshotId,
    snapshot_revision: plan.snapshotRevision,
    expires_tick: plan.expiresTick,
    kind: action.do,
    args: { ...action },
    state: 'accepted',
    result: null,
    receipt_id: null,
  } as ActionRecord;
  sink.actionChanged(record);
  record.state = 'running';
  sink.actionChanged(record);
  // An economic action writes its prepared receipt (intent to consume) before it runs (spec 1209).
  const economic = action.do === 'give' ? action : undefined;
  if (economic) {
    sink.receipt({
      receipt_id: receiptIdFor(actionId, 'prepared'),
      action_id: actionId,
      life_id: plan.lifeId,
      kind: economic.do,
      phase: 'prepared',
      at: now().toISOString(),
      item: economic.item,
      count: economic.count,
    });
  }
  let run: Awaited<ReturnType<BodyRuntime['runAction']>>;
  try {
    run = await runtime.runAction(action);
  } catch (error) {
    run = thrownRun(error);
  }
  const phase = run.state === 'completed' ? 'committed' : 'aborted';
  const receipt: Receipt = {
    receipt_id: receiptIdFor(actionId, phase),
    action_id: actionId,
    life_id: plan.lifeId,
    kind: action.do,
    phase,
    at: now().toISOString(),
    ...(economic ? { item: economic.item, count: economic.count } : {}),
    ...(run.result.message === undefined ? {} : { detail: run.result.message.slice(0, 256) }),
  };
  record.state = run.state;
  record.result = { ...run.result };
  record.receipt_id = receipt.receipt_id;
  sink.actionChanged(record);
  sink.receipt(receipt);
  return { record: structuredClone(record), duplicate: false };
}
