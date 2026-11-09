import type { ActionRecord, Receipt, Thought } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import { receiptIdFor } from './derived-id.ts';
import type { ActionReport, PlanEnvelope } from './executor.ts';
import type { BodyRuntime } from './runtime.ts';

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
  let run: Awaited<ReturnType<BodyRuntime['runAction']>>;
  try {
    run = await runtime.runAction(action);
  } catch (error) {
    run = {
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
  const phase = run.state === 'completed' ? 'committed' : 'aborted';
  const receipt: Receipt = {
    receipt_id: receiptIdFor(actionId, phase),
    action_id: actionId,
    life_id: plan.lifeId,
    kind: action.do,
    phase,
    at: now().toISOString(),
    ...(run.result.message === undefined ? {} : { detail: run.result.message.slice(0, 256) }),
  };
  record.state = run.state;
  record.result = { ...run.result };
  record.receipt_id = receipt.receipt_id;
  sink.actionChanged(record);
  sink.receipt(receipt);
  return { record: structuredClone(record), duplicate: false };
}
