import type { ActionRecord } from '@geldar/contract';
import type { ActionResult, JsonValue } from '../../src/actions/outcome.ts';
import { ulid } from '../../src/ulid.ts';

/** The `state` and `result` pair that `runAction` returns for one action. */
export interface RunOutcome {
  state: 'completed' | 'failed' | 'cancelled';
  result: ActionResult;
}

/**
 * A full `ActionRecord` around one action run, the way the Body stores it.
 *
 * Tests call this and pass the result to `validateActionRecord` from `@geldar/contract`.
 * Ids are fresh per call. The life, generation and snapshot revision are fixed.
 *
 * @param kind The action kind, such as `goto`.
 * @param args The action arguments as plain JSON.
 * @param run The `state` and `result` that the run produced.
 * @returns A record that fits the contract shape.
 */
export function recordFor(
  kind: string,
  args: Record<string, JsonValue>,
  run: RunOutcome,
): ActionRecord {
  return {
    action_id: `ac_${ulid()}`,
    intent_id: null,
    life_id: 'ag_kestrel_01',
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: `sn_${ulid()}`,
    snapshot_revision: 1,
    expires_tick: 24_000,
    kind,
    args,
    state: run.state,
    result: { ...run.result },
    receipt_id: null,
  };
}
