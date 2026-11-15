/**
 * Pure payload builders and readers for the sheet driver's one scripted life (step 0). No I/O here: the NATS
 * calls live in life-cli.ts. Every builder validates its output against the contract before it returns, so a
 * bad id, block or count never reaches the Body. Nothing here forges a row or an event: it only builds requests
 * and reads replies.
 */
import {
  type PlanMessage,
  type Snapshot,
  validatePlanAck,
  validatePlanMessage,
  validateSnapshot,
  validateSnapshotRequest,
} from '@geldar/contract';
import { ulid } from '../../ulid.ts';

/** A plan expires this many world ticks after its snapshot (one minute at 20 ticks a second). */
export const PLAN_TTL_TICKS = 1200;

export interface MineOnceIds {
  thoughtId: string;
  actionId: string;
}

export interface AckOutcome {
  accepted: boolean;
  rejection: { reason: string; detail: string } | null;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

/** A fresh thought id and action id, in the contract's `th_` and `ac_` shapes. */
export function newMineOnceIds(): MineOnceIds {
  return { thoughtId: `th_${ulid()}`, actionId: `ac_${ulid()}` };
}

/** The SnapshotRequest body for one life. Throws when the contract refuses it. */
export function buildSnapshotRequest(lifeId: string, reason: string): { life_id: string; reason: string } {
  const value = { life_id: lifeId, reason };
  const checked = validateSnapshotRequest(value);
  if (!checked.ok) throw new Error(`snapshot request refused: ${checked.errors.join('; ')}`);
  return value;
}

/** Reads the Body's snapshot reply. Throws on text that is not a valid Snapshot. */
export function parseSnapshotReply(text: string): Snapshot {
  const checked = validateSnapshot(parseJson(text, 'snapshot reply'));
  if (!checked.ok) throw new Error(`snapshot reply invalid: ${checked.errors.join('; ')}`);
  return checked.value;
}

export interface MineOnceInput {
  lifeId: string;
  snapshot: Snapshot;
  block: string;
  count: number;
  ids: MineOnceIds;
}

/**
 * One PlanMessage with a single `mine` action, built from the snapshot the Body just sent. The snapshot must
 * belong to the life and carry a body_generation (the Body checks it on the plan). Throws on any contract
 * violation, including a block that is not an item name or a count outside 1 to 256.
 */
export function buildMineOncePlan(input: MineOnceInput): PlanMessage {
  const { lifeId, snapshot, block, count, ids } = input;
  if (snapshot.agent_id !== lifeId) {
    throw new Error(`snapshot is for ${snapshot.agent_id}, not ${lifeId}`);
  }
  if (snapshot.body_generation === undefined) {
    throw new Error('snapshot has no body_generation, so a plan cannot be checked against it');
  }
  const plan = {
    thought_id: ids.thoughtId,
    life_id: lifeId,
    body_generation: snapshot.body_generation,
    source_snapshot_id: snapshot.snapshot_id,
    snapshot_revision: snapshot.revision,
    expires_tick: snapshot.world_time.ticks + PLAN_TTL_TICKS,
    action_ids: [ids.actionId],
    thought: {
      reasoning: 'Sheet driver step 0: one scripted mine, no model.',
      actions: [{ do: 'mine', block, count }],
    },
  };
  const checked = validatePlanMessage(plan);
  if (!checked.ok) throw new Error(`plan refused by the contract: ${checked.errors.join('; ')}`);
  return checked.value;
}

/** Reads the Body's PlanAck. Throws on a bad reply or an ack for another thought. */
export function parseAck(text: string, thoughtId: string): AckOutcome {
  const checked = validatePlanAck(parseJson(text, 'plan ack'));
  if (!checked.ok) throw new Error(`plan ack invalid: ${checked.errors.join('; ')}`);
  if (checked.value.thought_id !== thoughtId) throw new Error('plan ack is for another thought');
  return { accepted: checked.value.accepted, rejection: checked.value.rejection };
}

/**
 * The payload of the `plan_result` event for one thought, or null. A message on the subject that is not a
 * plan_result for this thought (another thought, another type, or text that is not JSON) gives null, so the
 * caller keeps waiting for its own result.
 */
export function planResultFor(text: string, thoughtId: string): Record<string, unknown> | null {
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const { type, payload } = event as { type?: unknown; payload?: unknown };
  if (type !== 'plan_result' || typeof payload !== 'object' || payload === null) return null;
  if ((payload as { thought_id?: unknown }).thought_id !== thoughtId) return null;
  return payload as Record<string, unknown>;
}
